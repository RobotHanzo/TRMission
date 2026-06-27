import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Collection, Db } from 'mongodb';
import { MONGO_DB } from '../db/tokens';

export type RoomStatus = 'LOBBY' | 'STARTED' | 'CLOSED';

export interface RoomMember {
  userId: string;
  displayName: string;
  isGuest: boolean;
  seat: number;
  ready: boolean;
}

export interface RoomDoc {
  _id: string; // room code
  hostId: string;
  status: RoomStatus;
  members: RoomMember[];
  maxPlayers: number;
  gameId?: string;
  seed?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type JoinResult = RoomDoc | 'not_found' | 'full' | 'started' | 'already';

// Room codes: 6 chars, no easily-confused glyphs (no I/O/0/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string =>
  Array.from({ length: 6 }, () => ALPHABET.charAt(randomInt(ALPHABET.length))).join('');

@Injectable()
export class RoomRepo implements OnModuleInit {
  private readonly col: Collection<RoomDoc>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<RoomDoc>('rooms');
  }

  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ status: 1, updatedAt: -1 });
  }

  get(code: string): Promise<RoomDoc | null> {
    return this.col.findOne({ _id: code });
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

  async markStarted(code: string, hostId: string, gameId: string, seed: string): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: code, hostId, status: 'LOBBY' },
      { $set: { status: 'STARTED', gameId, seed, updatedAt: new Date() } },
    );
    return res.modifiedCount === 1;
  }
}
