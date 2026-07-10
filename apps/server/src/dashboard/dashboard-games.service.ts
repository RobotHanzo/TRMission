import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Db, Collection } from 'mongodb';
import { MONGO_DB } from '../db/tokens';
import { GameHub } from '../ws/hub';
import { GameRegistry } from '../game/game-registry';
import { RoomRepo, DEFAULT_ROOM_SETTINGS, type RoomDoc } from '../lobby/room.repo';
import { HistoryRepo } from '../history/history.repo';
import type { AuthUser } from '../auth/auth.types';
import { TokenService } from '../auth/token.service';
import { env } from '../config/env';
import type { GameChatDoc, GameDoc, GameEventDoc } from '../persistence/types';
import { AuditService } from './audit.service';
import { decodeCursor, encodeCursor } from './cursor';

const toGameRow = (g: GameDoc, inMemory: boolean) => ({
  gameId: g._id,
  status: g.status,
  currentSeq: g.currentSeq,
  playerCount: g.config.players.length,
  botCount: g.bots?.length ?? 0,
  engineVersion: g.engineVersion,
  contentHash: g.contentHash,
  inMemory,
  createdAt: g.createdAt.toISOString(),
  updatedAt: g.updatedAt.toISOString(),
});

const toRoomRow = (r: RoomDoc) => ({
  code: r._id,
  hostId: r.hostId,
  status: r.status,
  memberCount: r.members.length,
  maxPlayers: r.maxPlayers,
  visibility: r.settings.visibility,
  ...(r.gameId ? { gameId: r.gameId } : {}),
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  members: r.members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    isBot: m.isBot === true,
    seat: m.seat,
  })),
});

// Games + rooms read surface. The one rule that must hold everywhere here: a LIVE
// game's hidden information never leaves — no state, no action log, and no seed
// (seed + contentHash deterministically encodes deck order, i.e. every hand).
@Injectable()
export class DashboardGamesService {
  private readonly games: Collection<GameDoc>;
  private readonly events: Collection<GameEventDoc>;
  private readonly chats: Collection<GameChatDoc>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly registry: GameRegistry,
    private readonly hub: GameHub,
    private readonly rooms: RoomRepo,
    private readonly history: HistoryRepo,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {
    this.games = db.collection<GameDoc>('games');
    this.events = db.collection<GameEventDoc>('gameEvents');
    this.chats = db.collection<GameChatDoc>('gameChats');
  }

  async listGames(query: { status: string; limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(query.cursor);
    const page = cursor
      ? {
          $or: [{ updatedAt: { $lt: cursor.t } }, { updatedAt: cursor.t, _id: { $lt: cursor.id } }],
        }
      : {};
    const filter =
      query.status === 'all' ? page : { status: query.status as GameDoc['status'], ...page };
    const docs = await this.games
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(query.limit)
      .toArray();
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      games: docs.map((g) => toGameRow(g, this.registry.get(g._id) !== undefined)),
      nextCursor: last ? encodeCursor(last.updatedAt, last._id) : null,
    };
  }

  async gameDetail(gameId: string) {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) throw new NotFoundException('game not found');

    const [room, chat, names] = await Promise.all([
      this.rooms.findByGameId(gameId),
      this.chats.find({ gameId }).sort({ seq: 1 }).toArray(),
      this.history.displayNames(game.config.players.map((p) => p.id)),
    ]);
    const botsById = new Map((game.bots ?? []).map((b) => [b.playerId, b]));

    return {
      gameId: game._id,
      status: game.status,
      currentSeq: game.currentSeq,
      engineVersion: game.engineVersion,
      contentHash: game.contentHash,
      schemaVersion: game.schemaVersion,
      inMemory: this.registry.get(gameId) !== undefined,
      createdAt: game.createdAt.toISOString(),
      updatedAt: game.updatedAt.toISOString(),
      // LIVE → the seed stays server-side (it encodes deck order = every hidden hand).
      ...(game.status !== 'LIVE' ? { seed: game.seed } : {}),
      players: game.config.players.map((p) => ({
        id: p.id,
        seat: p.seat,
        ...(names.has(p.id) ? { displayName: names.get(p.id) } : {}),
        isBot: botsById.has(p.id),
        ...(botsById.has(p.id) ? { difficulty: botsById.get(p.id)!.difficulty } : {}),
      })),
      spectators: game.spectators ?? [],
      ...(room ? { roomCode: room._id } : {}),
      chat: chat.map((c) => ({
        playerId: c.playerId,
        ts: c.ts.toISOString(),
        kind: c.content.case === 'presetId' ? ('preset' as const) : ('text' as const),
        value: c.content.value,
      })),
      ...(game.terminatedAt
        ? {
            terminated: {
              at: game.terminatedAt.toISOString(),
              by: game.terminatedBy ?? 'unknown',
              ...(game.terminatedReason ? { reason: game.terminatedReason } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Force-terminate a stuck LIVE game. Order matters: the DB flips first (so a
   * reconnect racing the eviction hits loadForRecovery's TERMINATED filter and cannot
   * resurrect the match), then the hub evicts + notifies, then the room closes. An
   * in-flight command may still append to the event log during step 1→2 — harmless:
   * the log stays digest-consistent and nothing reads it as live afterwards.
   */
  async terminate(actor: AuthUser, gameId: string, reason?: string) {
    const now = new Date();
    const res = await this.games.updateOne(
      { _id: gameId, status: 'LIVE' },
      {
        $set: {
          status: 'TERMINATED',
          terminatedAt: now,
          terminatedBy: actor.userId,
          ...(reason ? { terminatedReason: reason } : {}),
          updatedAt: now,
        },
      },
    );
    if (res.matchedCount === 0) {
      const game = await this.games.findOne({ _id: gameId });
      if (!game) throw new NotFoundException('game not found');
      throw new ConflictException(`game is ${game.status}, not LIVE`);
    }
    await this.hub.evictMatch(gameId, 'terminated by a moderator');
    await this.rooms.closeByGameId(gameId);
    await this.audit.log(
      actor,
      'game.terminate',
      { type: 'game', id: gameId },
      reason ? { reason } : {},
    );
    return this.gameDetail(gameId);
  }

  /** Force-close a LOBBY room. A STARTED room follows its game — terminate that instead. */
  async closeRoom(actor: AuthUser, code: string, reason?: string) {
    const room = await this.rooms.get(code);
    if (!room) throw new NotFoundException('room not found');
    if (room.status === 'CLOSED') throw new ConflictException('room is already closed');
    if (room.status === 'STARTED') {
      throw new ConflictException('room has a started game — terminate the game instead');
    }
    if (!(await this.rooms.closeLobby(code))) {
      throw new ConflictException('room is no longer in LOBBY');
    }
    await this.audit.log(actor, 'room.close', { type: 'room', id: code }, reason ? { reason } : {});
    const updated = await this.rooms.get(code);
    return toRoomRow(updated ?? room);
  }

  /** Maintainer reassignment of a LOBBY room's host — not gated on being the current host. */
  async transferHost(actor: AuthUser, code: string, targetId: string, reason?: string) {
    const r = await this.rooms.transferHostAdmin(code, targetId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new ConflictException('room is no longer in LOBBY');
    if (r === 'invalid') throw new BadRequestException('cannot transfer to that player');
    await this.audit.log(
      actor,
      'room.transferHost',
      { type: 'room', id: code },
      { targetId, ...(reason ? { reason } : {}) },
    );
    return toRoomRow(r);
  }

  /** Full ordered action log — COMPLETED games only (same hard rule as replay). */
  async gameLog(gameId: string) {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) throw new NotFoundException('game not found');
    if (game.status !== 'COMPLETED') {
      // Inside the dashboard the game's existence is already disclosed — be honest.
      throw new ConflictException('action log is only available for completed games');
    }
    const events = await this.events.find({ gameId }).sort({ seq: 1 }).toArray();
    return {
      gameId,
      entries: events.map((e) => ({
        seq: e.seq,
        action: e.action,
        stateDigest: e.stateDigest,
        ts: e.ts.toISOString(),
      })),
    };
  }

  /** Mint a short-lived ticket a maintainer hands off to apps/web's ticket-authorized
   *  replay route — works for COMPLETED and TERMINATED games (unlike the player-facing
   *  replay feature, which stays COMPLETED-only forever; see HistoryRepo.loadReplayForAdmin). */
  async mintReplayTicket(
    actor: AuthUser,
    gameId: string,
  ): Promise<{ ticket: string; expiresIn: string }> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) throw new NotFoundException('game not found');
    if (game.status !== 'COMPLETED' && game.status !== 'TERMINATED') {
      throw new ConflictException('replay is only available for completed or terminated games');
    }
    await this.audit.log(actor, 'game.viewReplay', { type: 'game', id: gameId });
    return {
      ticket: this.tokens.signAdminReplayTicket({ gameId, actorId: actor.userId }),
      expiresIn: env.adminReplayTicketTtl,
    };
  }

  /** Mint a short-lived ws-game ticket that force-joins a maintainer as a spectator on a LIVE
   *  game — bypassing the room's allowSpectating setting and the "not already seated" check
   *  entirely, since the maintainer is never a room member. This is literally the SAME ws-game
   *  ticket kind (kind: 'ws-game', seat: -1) a normal spectator gets from
   *  LobbyService.spectateTicket; the hub's ClientHello path needs no changes at all. */
  async mintSpectateTicket(
    actor: AuthUser,
    gameId: string,
  ): Promise<{ ticket: string; expiresIn: string }> {
    const game = await this.games.findOne({ _id: gameId });
    if (!game) throw new NotFoundException('game not found');
    if (game.status !== 'LIVE') {
      throw new ConflictException('spectating is only available for LIVE games');
    }
    await this.audit.log(actor, 'game.spectateLive', { type: 'game', id: gameId });
    return {
      ticket: this.tokens.signWsTicket({ gameId, playerId: actor.userId, seat: -1 }),
      expiresIn: env.wsTicketTtl,
    };
  }

  /**
   * Replay payload with the MEMBERSHIP check bypassed — never the COMPLETED gate, which
   * stays in exactly one place for the PLAYER-FACING path (HistoryRepo.loadReplay). A
   * second, deliberately more permissive path exists for maintainers
   * (HistoryRepo.loadReplayForAdmin, reachable only via a minted ticket — see
   * admin-replay.controller.ts) that also accepts TERMINATED games.
   */
  async gameReplay(gameId: string) {
    const doc = await this.history.get(gameId);
    const data = await this.history.loadReplay(gameId);
    if (!doc || !data) throw new NotFoundException('replay not available');
    const names = await this.history.displayNames(doc.players.map((p) => p.userId));
    const botsById = new Map(data.bots.map((b) => [b.playerId, b]));
    return {
      gameId: doc._id,
      config: data.config,
      engineVersion: data.engineVersion,
      schemaVersion: data.schemaVersion,
      actions: data.actions,
      players: doc.players.map((p) => ({
        userId: p.userId,
        seat: p.seat,
        ...(names.has(p.userId) ? { displayName: names.get(p.userId) } : {}),
        ...(botsById.has(p.userId)
          ? { isBot: true, difficulty: botsById.get(p.userId)!.difficulty }
          : {}),
      })),
      winners: doc.winners,
      completedAt: doc.completedAt.toISOString(),
      ...(data.finalDigest ? { finalDigest: data.finalDigest } : {}),
      visibility: doc.replayVisibility === 'link' ? 'link' : 'private',
      canConfigureVisibility: false,
    };
  }

  async listRooms(query: { status: string; limit: number; cursor?: string | undefined }) {
    const docs = await this.rooms.listPage(
      query.status as RoomDoc['status'] | 'all',
      query.limit,
      decodeCursor(query.cursor),
    );
    const last = docs.length === query.limit ? docs[docs.length - 1] : undefined;
    return {
      rooms: docs.map(toRoomRow),
      nextCursor: last ? encodeCursor(last.updatedAt, last._id) : null,
    };
  }

  async roomDetail(code: string) {
    const room = await this.rooms.get(code);
    if (!room) throw new NotFoundException('room not found');

    const gameDoc = room.gameId
      ? await this.games.findOne({ _id: room.gameId }, { projection: { status: 1 } })
      : null;
    // Merge over defaults so a room written before a settings field existed still projects fully.
    const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    const hostName = room.members.find((m) => m.userId === room.hostId)?.displayName;

    return {
      code: room._id,
      hostId: room.hostId,
      ...(hostName ? { hostName } : {}),
      status: room.status,
      visibility: settings.visibility,
      maxPlayers: room.maxPlayers,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      ...(room.gameId ? { gameId: room.gameId } : {}),
      ...(gameDoc?.status ? { gameStatus: gameDoc.status } : {}),
      // NOTE: room.seed is deliberately never projected — it encodes deck order (hidden hands).
      members: room.members.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        seat: m.seat,
        isBot: m.isBot === true,
        isGuest: m.isGuest === true,
        ready: m.ready === true,
        ...(m.difficulty ? { difficulty: m.difficulty } : {}),
      })),
      spectators: (room.spectators ?? []).map((s) => ({
        userId: s.userId,
        displayName: s.displayName,
      })),
      settings: {
        map:
          settings.map.source === 'custom'
            ? { source: 'custom' as const, id: settings.map.customMapId }
            : { source: 'official' as const, id: settings.map.mapId },
        allowSpectating: settings.allowSpectating,
        eventsMode: settings.eventsMode,
        unlimitedStationBorrow: settings.unlimitedStationBorrow,
        secondDrawAfterBlindRainbow: settings.secondDrawAfterBlindRainbow,
        noUnfinishedTicketPenalty: settings.noUnfinishedTicketPenalty,
        doubleRouteSingleFor23: settings.doubleRouteSingleFor23,
      },
    };
  }
}
