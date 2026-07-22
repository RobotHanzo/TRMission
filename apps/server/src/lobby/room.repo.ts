import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { seatOrderMovingToTeam, teamOfSeat, type EventsMode, type ChatPresetId } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';
import type { BotDifficulty } from '@trm/bots';
import type { GameDoc } from '../persistence/types';

export type RoomStatus = 'LOBBY' | 'STARTED' | 'CLOSED';
export type RoomVisibility = 'PUBLIC' | 'INVITE_ONLY';

/** Which map a room's game will be played on. 'custom' is validated/resolved by MapsService. */
export type MapSelector =
  | { source: 'official'; mapId: string }
  | { source: 'custom'; customMapId: string };

/** Host-configured per-game settings. Rule variants flow into the engine at start; spectating,
 *  visibility, and the map selection are control-plane only. */
export interface RoomSettings {
  unlimitedStationBorrow: boolean;
  secondDrawAfterBlindRainbow: boolean;
  noUnfinishedTicketPenalty: boolean;
  doubleRouteSingleFor23: boolean;
  /** Random-events tier fed into the engine at start ('off' = feature absent). Gated server-side
   *  by the host's per-account `randomEvents` feature (`@trm/shared`'s `USER_FEATURES`) — a room
   *  can only carry a non-'off' value while its host holds that feature. */
  eventsMode: EventsMode;
  /** Team game: 0 = free-for-all, else the number of teams (2–3). Membership is `seat %
   *  teamCount`, so arranging teams in the lobby means reordering seats. */
  teamCount: number;
  /** How players get sorted into teams: the host shuffles everyone ('random'), the host places
   *  each player individually ('host'), or every player picks their own team ('self'). Only
   *  meaningful while `teamCount > 0`. Defaults to 'host' — today's only behavior — so existing
   *  rooms need no migration. */
  teamAssignMode: 'random' | 'host' | 'self';
  allowSpectating: boolean;
  visibility: RoomVisibility;
  map: MapSelector;
  /** Solo rooms (host + bots only): wait for the host instead of running the per-turn timer —
   *  the started game never arms it, so bots simply rest until the host acts. Only honoured at
   *  start when exactly one human is seated. Default on. */
  soloWaitForHost: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  eventsMode: 'moderate',
  teamCount: 0,
  teamAssignMode: 'host',
  allowSpectating: true,
  visibility: 'INVITE_ONLY',
  map: { source: 'official', mapId: 'taiwan' },
  soloWaitForHost: true,
};

export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
  /** Bot members are computer-controlled; they are always ready and never connect. */
  isBot?: boolean;
  difficulty?: BotDifficulty;
  /** Advisory "I want to play again" vote, meaningful only while status === 'STARTED'.
   *  Reset to false whenever a game starts or a rematch resets the room to LOBBY. */
  wantsRematch?: boolean;
  /** Vote to end the active game immediately. The host's affirmative vote is authoritative;
   *  otherwise the game ends once all but one eligible human player have voted yes. */
  wantsEnd?: boolean;
}

export interface RoomChatEntry {
  userId: string;
  ts: number;
  /** Exactly one of presetId / text is set. Legacy rows carry presetId. */
  presetId?: string;
  text?: string;
}

export interface RoomSpectator {
  userId: string;
  displayName: string;
  isGuest: boolean;
}

export interface RoomDoc {
  _id: string; // room code
  hostId: string;
  status: RoomStatus;
  members: RoomMember[];
  maxPlayers: number;
  settings: RoomSettings;
  gameId?: string;
  seed?: string;
  /** Capped, ephemeral preset-only chat for the lobby (never persisted past the room's lifetime). */
  chat?: RoomChatEntry[];
  /** Anyone watching this room's game — populated by a lobby demote (below) or by minting a
   *  post-start spectate ticket (`LobbyService.spectateTicket`). One list for both paths, so
   *  a spectator's identity is known everywhere regardless of how they came to be watching. */
  spectators?: RoomSpectator[];
  createdAt: Date;
  updatedAt: Date;
}

export type UpdateSettingsResult = RoomDoc | 'not_found' | 'forbidden' | 'started';

/** A settings patch from the wire: each field optional and may be explicitly undefined (matches the
 *  zod `.partial()` DTO under exactOptionalPropertyTypes). Undefined values are ignored on merge. */
export type RoomSettingsPatch = { [K in keyof RoomSettings]?: RoomSettings[K] | undefined };

export type JoinResult = RoomDoc | 'not_found' | 'full' | 'started' | 'already';
export type AddBotResult = RoomDoc | 'not_found' | 'full' | 'started' | 'forbidden';
export type RemoveBotResult = RoomDoc | 'not_found' | 'forbidden' | 'started';
export type KickResult = RoomDoc | 'not_found' | 'forbidden' | 'started' | 'invalid';
export type ReseatResult = RoomDoc | 'not_found' | 'forbidden' | 'started' | 'invalid';
export type JoinTeamResult =
  | RoomDoc
  | 'not_found'
  | 'started'
  | 'not_member'
  | 'mode_disabled'
  | 'invalid_team'
  | 'already';
export type SendChatResult = RoomDoc | 'not_found' | 'not_member' | 'rate_limited';
export type EndVoteResult = RoomDoc | 'not_found' | 'not_member' | 'not_started';
export type BecomeSpectatorResult =
  | RoomDoc
  | 'not_found'
  | 'started'
  | 'not_member'
  | 'is_host'
  | 'only_member'
  | 'spectating_disabled';
export type BecomePlayerResult = RoomDoc | 'not_found' | 'started' | 'not_spectator' | 'full';
export type TransferHostResult = RoomDoc | 'not_found' | 'forbidden' | 'started' | 'invalid';
/** transferHostAdmin has no caller-is-host check, so it can never produce 'forbidden'. */
export type AdminTransferHostResult = RoomDoc | 'not_found' | 'started' | 'invalid';
export type CloseRoomResult = RoomDoc | 'not_found' | 'forbidden' | 'started';

/** A public-listing row: for a STARTED room, `game` carries the linked game's version stamps
 *  and status (0 or 1 elements — `gameId` is unique) so the caller can filter out rooms whose
 *  map/engine version is no longer resolvable, or whose game already ended. Absent for LOBBY
 *  rooms, which have no game yet. */
export interface PublicRoomDoc extends RoomDoc {
  game?: Pick<GameDoc, 'contentHash' | 'engineVersion' | 'status'>[];
}

// Room codes: 6 chars, no easily-confused glyphs (no I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('');

const ROOM_CHAT_CAP = 30;
const ROOM_CHAT_RATE_MAX = 5;
const ROOM_CHAT_RATE_WINDOW_MS = 5000;
export const ROOM_CHAT_MAX_LEN = 2048;

@Injectable()
export class RoomRepo implements OnModuleInit {
  private readonly col: Collection<RoomDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<RoomDoc>('rooms');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ status: 1, updatedAt: -1 });
    await this.col.createIndex({ 'settings.visibility': 1, status: 1, updatedAt: -1 });
    await this.col.createIndex({ 'members.userId': 1, status: 1, updatedAt: -1 });
    await this.col.createIndex({ gameId: 1 }, { sparse: true }); // dashboard game→room lookup
  }

  get(code: string): Promise<RoomDoc | null> {
    return this.col.findOne({ _id: code });
  }

  /** The room a game was started from (dashboard game detail / termination cleanup). */
  findByGameId(gameId: string): Promise<RoomDoc | null> {
    return this.col.findOne({ gameId });
  }

  /** Maintainer force-close of a lobby. CAS on LOBBY so a concurrent start wins cleanly. */
  async closeLobby(code: string): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: code, status: 'LOBBY' },
      { $set: { status: 'CLOSED', updatedAt: new Date() } },
    );
    return res.modifiedCount === 1;
  }

  /** Close the room of a terminated game (members list is kept for the record). */
  async closeByGameId(gameId: string): Promise<void> {
    await this.col.updateOne(
      { gameId, status: 'STARTED' },
      { $set: { status: 'CLOSED', updatedAt: new Date() } },
    );
  }

  /** Dashboard listing: newest first with a (updatedAt, _id) composite cursor. */
  listPage(
    status: RoomStatus | 'all',
    limit: number,
    cursor: { t: Date; id: string } | null,
  ): Promise<RoomDoc[]> {
    const page = cursor
      ? {
          $or: [{ updatedAt: { $lt: cursor.t } }, { updatedAt: cursor.t, _id: { $lt: cursor.id } }],
        }
      : {};
    return this.col
      .find({ ...(status === 'all' ? {} : { status }), ...page })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  async create(host: RoomMember, maxPlayers: number): Promise<RoomDoc> {
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const doc: RoomDoc = {
        _id: newCode(),
        hostId: host.userId,
        status: 'LOBBY',
        members: [{ ...host, seat: 0, ready: false }],
        maxPlayers,
        settings: { ...DEFAULT_ROOM_SETTINGS },
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.col.insertOne(doc);
        return doc;
      } catch {
        // duplicate code — retry with a new one
      }
    }
    throw new Error('could not allocate a room code');
  }

  /** Atomic join: CAS on the member-count so concurrent joiners get distinct seats. A full LOBBY
   *  room falls back to seating the joiner as a spectator (unless the room disables spectating).
   *  join() never promotes an existing spectator to a seat, full room or not — that stays the
   *  explicit becomePlayer/rejoin action. */
  async join(code: string, member: Omit<RoomMember, 'seat' | 'ready'>): Promise<JoinResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.col.findOne({ _id: code });
      if (!room) return 'not_found';
      if (room.status !== 'LOBBY') return 'started';
      if (room.members.some((m) => m.userId === member.userId)) return 'already';
      if (room.spectators?.some((s) => s.userId === member.userId)) return room;

      if (room.members.length >= room.maxPlayers) {
        const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
        if (!settings.allowSpectating) return 'full';
        const spectator: RoomSpectator = {
          userId: member.userId,
          displayName: member.displayName,
          isGuest: member.isGuest,
        };
        await this.col.updateOne(
          { _id: code, 'spectators.userId': { $ne: member.userId } },
          { $push: { spectators: spectator }, $set: { updatedAt: new Date() } },
        );
        return (await this.col.findOne({ _id: code })) ?? 'not_found';
      }

      const seat = room.members.length;
      const res = await this.col.updateOne(
        {
          _id: code,
          status: 'LOBBY',
          members: { $size: seat },
          'members.userId': { $ne: member.userId },
        },
        { $push: { members: { ...member, seat, ready: false } }, $set: { updatedAt: new Date() } },
      );
      if (res.modifiedCount === 1) {
        const updated = await this.col.findOne({ _id: code });
        if (updated) return updated;
      }
    }
    throw new Error('join contention');
  }

  async setReady(code: string, userId: string, ready: boolean): Promise<RoomDoc | null> {
    await this.col.updateOne(
      { _id: code, 'members.userId': userId },
      { $set: { 'members.$.ready': ready, updatedAt: new Date() } },
    );
    return this.col.findOne({ _id: code });
  }

  /** Leave a LOBBY room, or a STARTED room whose linked game has already ended (`gameIsOver`,
   *  determined by the caller via `GameHub.isGameOver` — a room left STARTED after its game
   *  finished can never advance on its own without a rematch, so leaving it behaves exactly like
   *  leaving a LOBBY: a spectator just drops off `spectators`; a seated member drops the member,
   *  keeps seats contiguous, and transfers host or closes exactly as before. A no-op for anything
   *  else — a still-LIVE game's seats are governed by the in-game vote/timeout machinery, not
   *  this endpoint. */
  async leave(code: string, userId: string, gameIsOver = false): Promise<RoomDoc | null> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return null;
    if (room.status !== 'LOBBY' && !(room.status === 'STARTED' && gameIsOver)) return room;

    if (room.spectators?.some((s) => s.userId === userId)) {
      await this.col.updateOne(
        { _id: code },
        { $pull: { spectators: { userId } }, $set: { updatedAt: new Date() } },
      );
      return this.col.findOne({ _id: code });
    }

    const remaining = room.members
      .filter((m) => m.userId !== userId)
      .map((m, i) => ({ ...m, seat: i }));
    if (remaining.length === 0) {
      await this.col.updateOne(
        { _id: code },
        { $set: { status: 'CLOSED', members: [], updatedAt: new Date() } },
      );
    } else if (room.hostId === userId) {
      const nextHuman = remaining.find((m) => !m.isBot);
      if (!nextHuman) {
        // Host leaving a room with only bots left — close it (there is no such thing as a bot host).
        await this.col.updateOne(
          { _id: code },
          { $set: { status: 'CLOSED', members: [], updatedAt: new Date() } },
        );
      } else {
        await this.col.updateOne(
          { _id: code },
          { $set: { members: remaining, hostId: nextHuman.userId, updatedAt: new Date() } },
        );
      }
    } else {
      await this.col.updateOne(
        { _id: code },
        { $set: { members: remaining, updatedAt: new Date() } },
      );
    }
    return this.col.findOne({ _id: code });
  }

  /** Host-only, LOBBY-only: merge a settings patch onto the room. */
  async updateSettings(
    code: string,
    hostId: string,
    patch: RoomSettingsPatch,
  ): Promise<UpdateSettingsResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    const clean: Partial<RoomSettings> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) (clean as Record<string, unknown>)[k] = v;
    }
    const settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings, ...clean };
    await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      { $set: { settings, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Public rooms for the home screen: PUBLIC lobbies (joinable) + PUBLIC started games that are
   *  still LIVE and allow spectating (watchable) — a STARTED room whose game already ended (and
   *  was never rematched back to LOBBY) has nothing left to watch, so it's excluded here rather
   *  than lingering as a dead entry. Newest first. Joins in each STARTED room's linked game
   *  version stamps + status (`game`) so the caller can further filter out rooms whose map/engine
   *  version is no longer resolvable — see `LobbyService.listPublic`, which then trims the result
   *  back down to `limit`. Fetches a larger candidate pool than `limit` (capped) so that filtering
   *  a few stale rows out of the page doesn't shrink the final list below what was asked for. */
  async findPublic(limit = 50): Promise<PublicRoomDoc[]> {
    const candidatePool = Math.min(limit * 3, 500);
    return this.col
      .aggregate<PublicRoomDoc>([
        {
          $match: {
            'settings.visibility': 'PUBLIC',
            $or: [{ status: 'LOBBY' }, { status: 'STARTED', 'settings.allowSpectating': true }],
          },
        },
        { $sort: { updatedAt: -1 } },
        { $limit: candidatePool },
        {
          $lookup: {
            from: 'games',
            localField: 'gameId',
            foreignField: '_id',
            as: 'game',
            pipeline: [{ $project: { contentHash: 1, engineVersion: 1, status: 1 } }],
          },
        },
        {
          $match: {
            $or: [{ status: 'LOBBY' }, { status: 'STARTED', 'game.status': 'LIVE' }],
          },
        },
      ])
      .toArray();
  }

  /** Rooms this user is currently seated in: their LOBBY rooms, plus STARTED rooms whose game
   *  is still LIVE (a room whose game finished is history, not something to return to).
   *  Newest first — the first entry is the natural "rejoin" target. */
  async findActiveByMember(userId: string, limit = 10): Promise<RoomDoc[]> {
    return this.col
      .aggregate<RoomDoc>([
        { $match: { status: { $in: ['LOBBY', 'STARTED'] }, 'members.userId': userId } },
        { $lookup: { from: 'games', localField: 'gameId', foreignField: '_id', as: 'game' } },
        { $match: { $or: [{ status: 'LOBBY' }, { 'game.status': 'LIVE' }] } },
        { $project: { game: 0 } },
        { $sort: { updatedAt: -1 } },
        { $limit: limit },
      ])
      .toArray();
  }

  async markStarted(code: string, hostId: string, gameId: string, seed: string): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      {
        $set: {
          status: 'STARTED',
          gameId,
          seed,
          'members.$[].wantsEnd': false,
          updatedAt: new Date(),
        },
      },
    );
    return res.modifiedCount === 1;
  }

  /** Host-only: append a bot member into the next free seat (atomic on member-count). */
  async addBot(
    code: string,
    hostId: string,
    bot: { userId: string; displayName: string; difficulty: BotDifficulty },
  ): Promise<AddBotResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.col.findOne({ _id: code });
      if (!room) return 'not_found';
      if (room.status !== 'LOBBY') return 'started';
      if (room.hostId !== hostId) return 'forbidden';
      if (room.members.length >= room.maxPlayers) return 'full';

      const seat = room.members.length;
      const member: RoomMember = {
        userId: bot.userId,
        displayName: bot.displayName,
        isGuest: false,
        seat,
        ready: true,
        isBot: true,
        difficulty: bot.difficulty,
      };
      const res = await this.col.updateOne(
        { _id: code, hostId, status: 'LOBBY', members: { $size: seat } },
        { $push: { members: member }, $set: { updatedAt: new Date() } },
      );
      if (res.modifiedCount === 1) {
        const updated = await this.col.findOne({ _id: code });
        if (updated) return updated;
      }
    }
    throw new Error('addBot contention');
  }

  /** Host-only: remove a bot member and keep seats contiguous. */
  async removeBot(code: string, hostId: string, botId: string): Promise<RemoveBotResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    const target = room.members.find((m) => m.userId === botId);
    if (!target || !target.isBot) return room; // not a bot in this room — no-op

    const remaining = room.members
      .filter((m) => m.userId !== botId)
      .map((m, i) => ({ ...m, seat: i }));
    await this.col.updateOne(
      { _id: code },
      { $set: { members: remaining, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /**
   * Host-only: reseat the table to an explicit order. `userIds` must be a permutation of the
   * current members — anything else is rejected rather than partially applied, so a stale client
   * (someone joined or left since it rendered) can never silently drop a player from the table.
   *
   * This is how teams are arranged: membership is `seat % teamCount`, so putting partners on
   * alternating seats IS choosing the teams. Also resets everyone's ready flag, because the table
   * a player agreed to is not the table they would now be playing.
   */
  async reseat(code: string, hostId: string, userIds: readonly string[]): Promise<ReseatResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';

    const current = room.members.map((m) => m.userId);
    const wanted = [...userIds];
    if (
      wanted.length !== current.length ||
      new Set(wanted).size !== wanted.length ||
      !wanted.every((id) => current.includes(id))
    ) {
      return 'invalid';
    }

    const byId = new Map(room.members.map((m) => [m.userId, m]));
    const reseated = wanted.map((id, i) => ({
      ...(byId.get(id) as RoomMember),
      seat: i,
      // Bots are always ready; humans must re-confirm the new seating.
      ready: byId.get(id)?.isBot === true,
    }));
    await this.col.updateOne(
      { _id: code, status: 'LOBBY', members: { $size: current.length } },
      { $set: { members: reseated, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /**
   * Any seated member (not just the host): move yourself onto `team`, gated on the room's
   * `teamAssignMode` being 'self' — the non-host counterpart to `reseat`. Swaps seats with
   * `team`'s lowest-seat current occupant (`seatOrderMovingToTeam`) rather than resetting
   * everyone's ready flag: only the two swapped members actually changed sides.
   */
  async joinTeam(code: string, userId: string, team: number): Promise<JoinTeamResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    if (settings.teamAssignMode !== 'self' || settings.teamCount <= 0) return 'mode_disabled';
    if (!Number.isInteger(team) || team < 0 || team >= settings.teamCount) return 'invalid_team';

    const me = room.members.find((m) => m.userId === userId);
    if (!me) return 'not_member';
    if (teamOfSeat(me.seat, settings.teamCount) === team) return 'already';

    const order = seatOrderMovingToTeam(room.members, userId, team, settings.teamCount);
    if (!order) return 'invalid_team'; // no seat currently belongs to `team` yet

    const byId = new Map(room.members.map((m) => [m.userId, m]));
    const reseated = order.map((id, seat) => {
      const member = byId.get(id) as RoomMember;
      // Only the two swapped members' sides actually changed — reset just their ready flags
      // (bots stay ready) rather than the whole table's, unlike a host-driven `reseat`.
      const moved = id === userId || member.seat !== seat;
      return { ...member, seat, ready: moved ? member.isBot === true : member.ready };
    });
    await this.col.updateOne(
      { _id: code, status: 'LOBBY', members: { $size: room.members.length } },
      { $set: { members: reseated, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Host-only: remove another member or spectator (human or bot) and keep seats contiguous.
   *  The host cannot kick themselves — leaving is a separate, host-transferring path. */
  async kick(code: string, hostId: string, targetId: string): Promise<KickResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    if (targetId === hostId) return 'invalid';

    if (room.spectators?.some((s) => s.userId === targetId)) {
      await this.col.updateOne(
        { _id: code },
        { $pull: { spectators: { userId: targetId } }, $set: { updatedAt: new Date() } },
      );
      return (await this.col.findOne({ _id: code })) ?? 'not_found';
    }

    if (!room.members.some((m) => m.userId === targetId)) return 'invalid';
    const remaining = room.members
      .filter((m) => m.userId !== targetId)
      .map((m, i) => ({ ...m, seat: i }));
    await this.col.updateOne(
      { _id: code },
      { $set: { members: remaining, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Any seated member (not just the host) records their advisory rematch preference. */
  async setRematchVote(
    code: string,
    userId: string,
    vote: boolean,
  ): Promise<RoomDoc | 'not_found' | 'not_member'> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (!room.members.some((m) => m.userId === userId)) return 'not_member';
    await this.col.updateOne(
      { _id: code, 'members.userId': userId },
      { $set: { 'members.$.wantsRematch': vote, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Any seated human member records (or retracts) their vote to end the active game. The
   *  decision threshold is evaluated by LobbyService from the returned authoritative room. */
  async setEndVote(code: string, userId: string, vote: boolean): Promise<EndVoteResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'STARTED' || !room.gameId) return 'not_started';
    if (!room.members.some((m) => m.userId === userId && !m.isBot)) return 'not_member';

    const update = await this.col.updateOne(
      { _id: code, status: 'STARTED', gameId: room.gameId, 'members.userId': userId },
      { $set: { 'members.$.wantsEnd': vote, updatedAt: new Date() } },
    );
    if (update.matchedCount !== 1) {
      // The pre-check above raced with a concurrent change (status flip, or this member being
      // removed from the room). Re-derive which one so the caller gets the right error instead of
      // a blanket "not started".
      const latest = await this.col.findOne({ _id: code });
      if (!latest) return 'not_found';
      if (!latest.members.some((m) => m.userId === userId && !m.isBot)) return 'not_member';
      return 'not_started';
    }
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Any room member sends a preset OR free-text chat message; rate-limited from the persisted
   *  array itself (no separate in-memory tracker) so it survives restarts without new state. */
  async sendChat(
    code: string,
    userId: string,
    entry: { presetId: ChatPresetId } | { text: string },
  ): Promise<SendChatResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    const isParticipant =
      room.members.some((m) => m.userId === userId) ||
      (room.spectators?.some((s) => s.userId === userId) ?? false);
    if (!isParticipant) return 'not_member';

    const now = Date.now();
    const recent = (room.chat ?? []).filter(
      (c) => c.userId === userId && now - c.ts < ROOM_CHAT_RATE_WINDOW_MS,
    );
    if (recent.length >= ROOM_CHAT_RATE_MAX) return 'rate_limited';

    await this.col.updateOne(
      { _id: code },
      {
        $push: { chat: { $each: [{ userId, ...entry, ts: now }], $slice: -ROOM_CHAT_CAP } },
        $set: { updatedAt: new Date() },
      },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Host-only: flip a finished room back to LOBBY for another round. CAS on the exact gameId
   *  being rematched so a stale/duplicate call is a clean no-op rather than clobbering a room
   *  that's already moved on to a different game. */
  async resetToLobby(code: string, hostId: string, expectedGameId: string): Promise<boolean> {
    const room = await this.col.findOne({
      _id: code,
      hostId,
      status: 'STARTED',
      gameId: expectedGameId,
    });
    if (!room) return false;
    const members = room.members.map((m) => ({
      ...m,
      ready: m.isBot === true,
      wantsRematch: false,
      wantsEnd: false,
    }));
    const res = await this.col.updateOne(
      { _id: code, hostId, status: 'STARTED', gameId: expectedGameId },
      {
        $set: { status: 'LOBBY', members, updatedAt: new Date() },
        $unset: { gameId: '', seed: '' },
      },
    );
    return res.modifiedCount === 1;
  }

  /** A seated non-host member gives up their seat to watch instead: everything but their identity
   *  moves out of `members` into `spectators` and seats renumber. Blocked for the host (owners
   *  can't spectate — they leave via transfer/close), if they're the room's only member (nothing
   *  left to seat), or if spectating is disabled (they'd be orphaned once the game starts). */
  async becomeSpectator(code: string, userId: string): Promise<BecomeSpectatorResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    const leaving = room.members.find((m) => m.userId === userId);
    if (!leaving) return 'not_member';
    if (room.hostId === userId) return 'is_host';
    if (room.members.length <= 1) return 'only_member';
    const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    if (!settings.allowSpectating) return 'spectating_disabled';

    const remaining = room.members
      .filter((m) => m.userId !== userId)
      .map((m, i) => ({ ...m, seat: i }));
    const spectator: RoomSpectator = {
      userId: leaving.userId,
      displayName: leaving.displayName,
      isGuest: leaving.isGuest,
    };
    await this.col.updateOne(
      { _id: code },
      { $set: { members: remaining }, $push: { spectators: spectator } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Host-only, LOBBY-only: hand ownership to another seated, non-bot member. */
  async transferHost(code: string, hostId: string, targetId: string): Promise<TransferHostResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    const target = room.members.find((m) => m.userId === targetId);
    if (!target || target.isBot || targetId === hostId) return 'invalid';
    await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      { $set: { hostId: targetId, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Maintainer force-reassignment: same target validation as transferHost, no caller-is-host check. */
  async transferHostAdmin(code: string, targetId: string): Promise<AdminTransferHostResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    const target = room.members.find((m) => m.userId === targetId);
    if (!target || target.isBot || targetId === room.hostId) return 'invalid';
    await this.col.updateOne(
      { _id: code, status: 'LOBBY' },
      { $set: { hostId: targetId, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** Host-only, LOBBY-only: close the room for everyone. CAS on LOBBY so a concurrent start wins. */
  async closeRoom(code: string, hostId: string): Promise<CloseRoomResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      { $set: { status: 'CLOSED', updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }

  /** A spectator takes an open seat back. Atomic seat-CAS retry loop, same shape as `join()`. */
  async becomePlayer(code: string, userId: string): Promise<BecomePlayerResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.col.findOne({ _id: code });
      if (!room) return 'not_found';
      if (room.status !== 'LOBBY') return 'started';
      const spectator = room.spectators?.find((s) => s.userId === userId);
      if (!spectator) return 'not_spectator';
      if (room.members.length >= room.maxPlayers) return 'full';

      const seat = room.members.length;
      const member: RoomMember = { ...spectator, seat, ready: false };
      const res = await this.col.updateOne(
        { _id: code, status: 'LOBBY', members: { $size: seat }, 'spectators.userId': userId },
        {
          $push: { members: member },
          $pull: { spectators: { userId } },
          $set: { updatedAt: new Date() },
        },
      );
      if (res.modifiedCount === 1) {
        const updated = await this.col.findOne({ _id: code });
        if (updated) return updated;
      }
    }
    throw new Error('becomePlayer contention');
  }

  /** Idempotent: records a spectator identity if not already present. Called both indirectly
   *  (via `becomeSpectator`, above) and directly by `LobbyService.spectateTicket`, so every path
   *  that watches a room's game ends up in the one list. */
  async recordSpectator(code: string, spectator: RoomSpectator): Promise<void> {
    await this.col.updateOne(
      { _id: code, 'spectators.userId': { $ne: spectator.userId } },
      { $push: { spectators: spectator } },
    );
  }
}
