import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import type { EventsMode, ChatPresetId } from '@trm/shared';
import { MONGO_DB } from '../db/tokens';
import type { BotDifficulty } from '@trm/bots';

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
  allowSpectating: boolean;
  visibility: RoomVisibility;
  map: MapSelector;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  unlimitedStationBorrow: true,
  secondDrawAfterBlindRainbow: false,
  noUnfinishedTicketPenalty: false,
  doubleRouteSingleFor23: true,
  eventsMode: 'off',
  allowSpectating: true,
  visibility: 'INVITE_ONLY',
  map: { source: 'official', mapId: 'taiwan' },
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
}

export interface RoomChatEntry {
  userId: string;
  presetId: string;
  ts: number;
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
export type SendChatResult = RoomDoc | 'not_found' | 'not_member' | 'rate_limited';

// Room codes: 6 chars, no easily-confused glyphs (no I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('');

const ROOM_CHAT_CAP = 30;
const ROOM_CHAT_RATE_MAX = 5;
const ROOM_CHAT_RATE_WINDOW_MS = 5000;

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

  /** Atomic join: CAS on the member-count so concurrent joiners get distinct seats. */
  async join(code: string, member: Omit<RoomMember, 'seat' | 'ready'>): Promise<JoinResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.col.findOne({ _id: code });
      if (!room) return 'not_found';
      if (room.status !== 'LOBBY') return 'started';
      if (room.members.some((m) => m.userId === member.userId)) return 'already';
      if (room.members.length >= room.maxPlayers) return 'full';

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

  /** Leave a LOBBY room: drop the member, keep seats contiguous, transfer host or close. */
  async leave(code: string, userId: string): Promise<RoomDoc | null> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return null;
    if (room.status !== 'LOBBY') return room;

    const remaining = room.members
      .filter((m) => m.userId !== userId)
      .map((m, i) => ({ ...m, seat: i }));
    if (remaining.length === 0) {
      await this.col.updateOne(
        { _id: code },
        { $set: { status: 'CLOSED', members: [], updatedAt: new Date() } },
      );
    } else {
      const hostId = room.hostId === userId ? (remaining[0]?.userId ?? room.hostId) : room.hostId;
      await this.col.updateOne(
        { _id: code },
        { $set: { members: remaining, hostId, updatedAt: new Date() } },
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

  /** Public rooms for the home screen: PUBLIC lobbies (joinable) + PUBLIC started games that
   *  allow spectating (watchable). Newest first. */
  async findPublic(limit = 50): Promise<RoomDoc[]> {
    return this.col
      .find({
        'settings.visibility': 'PUBLIC',
        $or: [{ status: 'LOBBY' }, { status: 'STARTED', 'settings.allowSpectating': true }],
      })
      .sort({ updatedAt: -1 })
      .limit(limit)
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
      { $set: { status: 'STARTED', gameId, seed, updatedAt: new Date() } },
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

  /** Host-only: remove another member (human or bot) and keep seats contiguous.
   *  The host cannot kick themselves — leaving is a separate, host-transferring path. */
  async kick(code: string, hostId: string, targetId: string): Promise<KickResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    if (room.hostId !== hostId) return 'forbidden';
    if (targetId === hostId) return 'invalid';
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

  /** Any room member sends a preset chat message; rate-limited from the persisted array itself
   *  (no separate in-memory tracker) so it survives restarts without new state. */
  async sendChat(code: string, userId: string, presetId: ChatPresetId): Promise<SendChatResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (!room.members.some((m) => m.userId === userId)) return 'not_member';

    const now = Date.now();
    const recent = (room.chat ?? []).filter(
      (c) => c.userId === userId && now - c.ts < ROOM_CHAT_RATE_WINDOW_MS,
    );
    if (recent.length >= ROOM_CHAT_RATE_MAX) return 'rate_limited';

    await this.col.updateOne(
      { _id: code },
      {
        $push: { chat: { $each: [{ userId, presetId, ts: now }], $slice: -ROOM_CHAT_CAP } },
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
}
