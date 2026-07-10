import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildBoard } from '@trm/engine';
import type { Board, GameConfig, PlayerSeed } from '@trm/engine';
import { officialMapById } from '@trm/map-data';
import type { MapRules } from '@trm/map-data';
import { asPlayerId, type SeatIndex, type ChatPresetId } from '@trm/shared';
import {
  RoomRepo,
  DEFAULT_ROOM_SETTINGS,
  ROOM_CHAT_MAX_LEN,
  type MapSelector,
  type RoomDoc,
  type RoomMember,
  type RoomSettings,
  type RoomSettingsPatch,
  type RoomChatEntry,
  type RoomSpectator,
} from './room.repo';
import { GameHub } from '../ws/hub';
import { TokenService } from '../auth/token.service';
import { UserRepo } from '../auth/user.repo';
import { featureDisabled } from '../auth/feature.guard';
import type { AuthUser } from '../auth/auth.types';
import { BOT_ID_PREFIX, type BotDifficulty, type BotProfile } from '../bots/types';
import { MapsService } from '../maps/maps.service';

export interface RoomView {
  code: string;
  hostId: string;
  status: RoomDoc['status'];
  maxPlayers: number;
  members: RoomMember[];
  spectators: RoomSpectator[];
  settings: RoomSettings;
  gameId?: string;
  mapName?: { zh: string; en: string };
  chat: RoomChatEntry[];
}

export interface TicketResult {
  gameId: string;
  ticket: string;
}

export interface PracticeResult extends TicketResult {
  code: string;
}

/** Display name for a map selector, when resolvable (official maps only, for now). */
function mapNameFor(selector: MapSelector): { zh: string; en: string } | undefined {
  if (selector.source !== 'official') return undefined;
  const official = officialMapById(selector.mapId);
  return official
    ? { zh: official.content.meta.nameZh, en: official.content.meta.nameEn }
    : undefined;
}

const toView = (r: RoomDoc): RoomView => {
  const settings = { ...DEFAULT_ROOM_SETTINGS, ...r.settings };
  const mapName = mapNameFor(settings.map);
  return {
    code: r._id,
    hostId: r.hostId,
    status: r.status,
    maxPlayers: r.maxPlayers,
    members: r.members,
    spectators: r.spectators ?? [],
    settings,
    ...(r.gameId ? { gameId: r.gameId } : {}),
    ...(mapName ? { mapName } : {}),
    chat: r.chat ?? [],
  };
};

@Injectable()
export class LobbyService {
  constructor(
    private readonly rooms: RoomRepo,
    private readonly hub: GameHub,
    private readonly tokens: TokenService,
    private readonly maps: MapsService,
    private readonly users: UserRepo,
  ) {}

  /**
   * Ban chokepoint for the ws-ticket paths (start / ticket / spectate): a banned user's
   * live 15-min access token must not be redeemable for game access. These routes are
   * human-paced, so the extra point read is negligible.
   */
  private async assertNotDisabled(userId: string): Promise<void> {
    const doc = await this.users.findById(userId);
    if (doc?.disabledAt) throw new ForbiddenException('account disabled');
  }

  /** Hosting/selecting a custom map is part of the mapBuilder feature (strict gate). */
  private async assertCustomMapAllowed(selector: MapSelector, userId: string): Promise<void> {
    if (selector.source !== 'custom') return;
    if (!(await this.users.hasFeature(userId, 'mapBuilder'))) {
      throw featureDisabled('mapBuilder');
    }
  }

  /** Turning on random events is part of the per-account randomEvents feature (same strict-gate
   *  pattern as mapBuilder) — a dashboard grant on the HOST, not a server-wide env var. */
  private async assertEventsAllowed(userId: string): Promise<void> {
    if (!(await this.users.hasFeature(userId, 'randomEvents'))) {
      throw featureDisabled('randomEvents');
    }
  }

  /** Validate a selector is usable (existence + ownership for custom), without fully resolving
   *  it — cheap enough to run on every settings PATCH. Full playability is checked at start. */
  private async assertMapSelectable(selector: MapSelector, callerUserId: string): Promise<void> {
    if (selector.source === 'official') {
      if (!officialMapById(selector.mapId)) {
        throw new BadRequestException(`unknown official map: ${selector.mapId}`);
      }
      return;
    }
    await this.assertCustomMapAllowed(selector, callerUserId);
    await this.maps.requireOwned(selector.customMapId, callerUserId);
  }

  /** Resolve a selector into the board/content/rules to actually start a game with. */
  private async resolveMapForStart(
    selector: MapSelector,
    callerUserId: string,
    maxPlayers: number,
  ): Promise<{ board: Board; contentHash: string; mapRules: MapRules }> {
    if (selector.source === 'official') {
      const official = officialMapById(selector.mapId);
      if (!official) throw new BadRequestException(`unknown official map: ${selector.mapId}`);
      return {
        board: buildBoard(official.content),
        contentHash: official.hash,
        mapRules: official.content.rules ?? {},
      };
    }
    await this.assertCustomMapAllowed(selector, callerUserId);
    const map = await this.maps.requireOwned(selector.customMapId, callerUserId);
    return this.maps.resolveForStart(map, maxPlayers);
  }

  async create(user: AuthUser, maxPlayers = 5): Promise<RoomView> {
    const host: RoomMember = {
      userId: user.userId,
      displayName: user.displayName,
      isGuest: user.isGuest,
      seat: 0,
      ready: false,
    };
    return toView(await this.rooms.create(host, maxPlayers));
  }

  async get(code: string): Promise<RoomView> {
    return toView(await this.require(code));
  }

  async join(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.join(code, {
      userId: user.userId,
      displayName: user.displayName,
      isGuest: user.isGuest,
    });
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'full') throw new BadRequestException('room is full');
    if (r === 'already') return this.get(code);
    return toView(r);
  }

  async leave(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.leave(code, user.userId);
    if (!r) throw new NotFoundException('room not found');
    return toView(r);
  }

  /** Host-only: hand ownership to another seated member (they stay seated). */
  async transferOwnership(code: string, user: AuthUser, targetId: string): Promise<RoomView> {
    const r = await this.rooms.transferHost(code, user.userId, targetId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can transfer ownership');
    if (r === 'invalid') throw new BadRequestException('cannot transfer to that player');
    return toView(r);
  }

  /** Host-only: close the whole room. */
  async closeRoom(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.closeRoom(code, user.userId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can close the room');
    return toView(r);
  }

  async ready(code: string, user: AuthUser, ready: boolean): Promise<RoomView> {
    const r = await this.rooms.setReady(code, user.userId, ready);
    if (!r) throw new NotFoundException('room not found');
    return toView(r);
  }

  /** Any seated member casts (or changes) their advisory rematch vote. */
  async voteRematch(code: string, user: AuthUser, vote: boolean): Promise<RoomView> {
    const r = await this.rooms.setRematchVote(code, user.userId, vote);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    return toView(r);
  }

  /** A seated member demotes to spectating. */
  async becomeSpectator(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.becomeSpectator(code, user.userId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    if (r === 'is_host') throw new BadRequestException('the host cannot spectate');
    if (r === 'only_member') throw new BadRequestException('cannot spectate as the only member');
    if (r === 'spectating_disabled') {
      throw new BadRequestException('spectating is disabled for this room');
    }
    return toView(r);
  }

  /** A spectator takes an open seat. */
  async becomePlayer(code: string, user: AuthUser): Promise<RoomView> {
    const r = await this.rooms.becomePlayer(code, user.userId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'not_spectator') throw new ForbiddenException('not a spectator of this room');
    if (r === 'full') throw new BadRequestException('room is full');
    return toView(r);
  }

  /** Any room member sends a preset OR a free-text chat message (exactly one). */
  async sendChat(
    code: string,
    user: AuthUser,
    payload: { presetId?: ChatPresetId | undefined; text?: string | undefined },
  ): Promise<RoomView> {
    const hasPreset = payload.presetId !== undefined;
    const hasText = payload.text !== undefined;
    if (hasPreset === hasText) throw new BadRequestException('send exactly one of preset or text');
    let entry: { presetId: ChatPresetId } | { text: string };
    if (hasPreset) {
      entry = { presetId: payload.presetId! };
    } else {
      const text = payload.text!.trim();
      if (text.length === 0) throw new BadRequestException('empty chat message');
      if (text.length > ROOM_CHAT_MAX_LEN) throw new BadRequestException('chat too long');
      entry = { text };
    }
    const r = await this.rooms.sendChat(code, user.userId, entry);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'not_member') throw new ForbiddenException('not a member of this room');
    if (r === 'rate_limited') throw new BadRequestException('sending chat too fast');
    return toView(r);
  }

  /** Host adds a computer player of the given difficulty into a free seat. */
  async addBot(code: string, user: AuthUser, difficulty: BotDifficulty): Promise<RoomView> {
    const botId = `${BOT_ID_PREFIX}${randomUUID()}`;
    const r = await this.rooms.addBot(code, user.userId, {
      userId: botId,
      displayName: `Bot-${difficulty}`,
      difficulty,
    });
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can add bots');
    if (r === 'full') throw new BadRequestException('room is full');
    return toView(r);
  }

  /** Host removes a bot from the room. */
  async removeBot(code: string, user: AuthUser, botId: string): Promise<RoomView> {
    const r = await this.rooms.removeBot(code, user.userId, botId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can remove bots');
    return toView(r);
  }

  /** Host removes another player from the room. */
  async kick(code: string, user: AuthUser, targetId: string): Promise<RoomView> {
    const r = await this.rooms.kick(code, user.userId, targetId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can remove players');
    if (r === 'invalid') throw new BadRequestException('cannot remove that player');
    return toView(r);
  }

  /** Host updates the per-game settings while the room is still in LOBBY. */
  async updateSettings(code: string, user: AuthUser, patch: RoomSettingsPatch): Promise<RoomView> {
    if (patch.map) await this.assertMapSelectable(patch.map, user.userId);
    // Server enforcement (UI hiding is not enough): the events option can only be turned on by a
    // host holding the randomEvents feature. Patching back to 'off' is always allowed.
    if (patch.eventsMode && patch.eventsMode !== 'off') {
      await this.assertEventsAllowed(user.userId);
    }
    const r = await this.rooms.updateSettings(code, user.userId, patch);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new BadRequestException('game already started');
    if (r === 'forbidden') throw new ForbiddenException('only the host can change settings');
    return toView(r);
  }

  /** Public rooms for the home screen (no auth required). */
  async listPublic(): Promise<RoomView[]> {
    return (await this.rooms.findPublic()).map(toView);
  }

  /** The caller's active rooms (lobby or live game) — powers the home screen's rejoin banner. */
  async listMine(user: AuthUser): Promise<RoomView[]> {
    return (await this.rooms.findActiveByMember(user.userId)).map(toView);
  }

  /** Host starts the game: create the authoritative match, mark the room STARTED, hand back a ticket. */
  async start(code: string, user: AuthUser): Promise<TicketResult> {
    await this.assertNotDisabled(user.userId);
    const room = await this.require(code);
    if (room.hostId !== user.userId) throw new ForbiddenException('only the host can start');
    if (room.status !== 'LOBBY') throw new BadRequestException('game already started');
    if (room.members.length < 2) throw new BadRequestException('need at least 2 players');
    if (!room.members.every((m) => m.ready))
      throw new BadRequestException('all players must be ready');

    const gameId = randomUUID();
    const seed = randomUUID();
    const players: PlayerSeed[] = room.members
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((m) => ({ id: asPlayerId(m.userId), seat: m.seat as SeatIndex }));
    const s = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    const { board, contentHash, mapRules } = await this.resolveMapForStart(
      s.map,
      user.userId,
      room.maxPlayers,
    );
    // The host is asserted above (`room.hostId === user.userId`), so this checks the same account
    // that configured the room.
    const eventsAllowed = await this.users.hasFeature(user.userId, 'randomEvents');
    const config: GameConfig = {
      seed,
      players,
      contentHash,
      // Randomize who acts first so the host (always seat 0) isn't perpetually the opening player.
      // Seeded off `config.seed` in `initGame`'s fixed RNG order, so replay stays byte-identical.
      shuffleTurnOrder: true,
      ruleParams: {
        ...mapRules,
        unlimitedStationBorrow: s.unlimitedStationBorrow,
        secondDrawAfterBlindRainbow: s.secondDrawAfterBlindRainbow,
        noUnfinishedTicketPenalty: s.noUnfinishedTicketPenalty,
        doubleRouteSingleFor23: s.doubleRouteSingleFor23,
        // Silent downgrade to 'off' if the feature was revoked between configure and start, so a
        // ready room is never stranded. The started game's game_settings.events_mode shows the truth.
        eventsMode: eventsAllowed ? s.eventsMode : 'off',
      },
    };
    const bots: BotProfile[] = room.members
      .filter((m) => m.isBot && m.difficulty)
      .map((m) => ({ playerId: m.userId, difficulty: m.difficulty as BotDifficulty }));

    if (!(await this.rooms.markStarted(code, user.userId, gameId, seed))) {
      throw new BadRequestException('could not start (already started?)');
    }
    await this.hub.createMatch(gameId, board, config, bots);
    return { gameId, ticket: this.ticketFor(gameId, user.userId, this.seatOf(room, user.userId)) };
  }

  /**
   * One-call quick start for the welcome screen's "practice with bots": create a room, seat one
   * EASY + one MEDIUM bot, mark the host ready, and start — all on the default map/rules. Returns
   * the ticket plus the room `code` (the client needs it for the /room/:code URL and reconnects).
   * Composes the existing host-only service methods, so all their validation still applies.
   */
  async startPractice(user: AuthUser): Promise<PracticeResult> {
    await this.assertNotDisabled(user.userId);
    const { code } = await this.create(user);
    await this.addBot(code, user, 'EASY');
    await this.addBot(code, user, 'MEDIUM');
    await this.ready(code, user, true);
    const ticket = await this.start(code, user);
    return { ...ticket, code };
  }

  /** Host-only: reset a finished game's room back to LOBBY for another round. */
  async rematch(code: string, user: AuthUser): Promise<RoomView> {
    const room = await this.require(code);
    if (room.hostId !== user.userId) throw new ForbiddenException('only the host can rematch');
    if (room.status !== 'STARTED' || !room.gameId) {
      throw new BadRequestException('no game to rematch');
    }
    if (!(await this.hub.isGameOver(room.gameId))) {
      throw new BadRequestException('game is still in progress');
    }
    if (!(await this.rooms.resetToLobby(code, user.userId, room.gameId))) {
      throw new BadRequestException('could not rematch (already rematched?)');
    }
    return this.get(code);
  }

  /** Mint a spectator ws-ticket (seat -1) for a started room, if it allows spectating. Also
   *  records the caller onto `RoomDoc.spectators` (idempotent) — the same list a lobby demote
   *  populates, so every path that watches this room's game shares one identity list. */
  async spectateTicket(code: string, user: AuthUser): Promise<TicketResult> {
    await this.assertNotDisabled(user.userId);
    const room = await this.require(code);
    const s = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    if (!s.allowSpectating) throw new ForbiddenException('spectating is disabled for this room');
    if (!room.gameId) throw new BadRequestException('game has not started');
    if (this.seatOf(room, user.userId) >= 0) {
      throw new ForbiddenException('players cannot spectate their own game');
    }
    await this.rooms.recordSpectator(code, {
      userId: user.userId,
      displayName: user.displayName,
      isGuest: user.isGuest,
    });
    return {
      gameId: room.gameId,
      ticket: this.tokens.signWsTicket({ gameId: room.gameId, playerId: user.userId, seat: -1 }),
    };
  }

  /** Mint a ws-game ticket for the current member of a started room (initial + reconnect). */
  async ticket(code: string, user: AuthUser): Promise<TicketResult> {
    await this.assertNotDisabled(user.userId);
    const room = await this.require(code);
    if (!room.gameId) throw new BadRequestException('game has not started');
    const seat = this.seatOf(room, user.userId);
    if (seat < 0) throw new ForbiddenException('not a member of this game');
    return { gameId: room.gameId, ticket: this.ticketFor(room.gameId, user.userId, seat) };
  }

  private async require(code: string): Promise<RoomDoc> {
    const room = await this.rooms.get(code);
    if (!room) throw new NotFoundException('room not found');
    return room;
  }

  private seatOf(room: RoomDoc, userId: string): number {
    return room.members.find((m) => m.userId === userId)?.seat ?? -1;
  }

  private ticketFor(gameId: string, userId: string, seat: number): string {
    return this.tokens.signWsTicket({ gameId, playerId: userId, seat });
  }
}
