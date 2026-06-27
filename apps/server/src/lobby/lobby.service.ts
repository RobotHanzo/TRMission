import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { RoomRepo, type RoomDoc, type RoomMember } from './room.repo';
import { GameHub } from '../ws/hub';
import { TokenService } from '../auth/token.service';
import type { AuthUser } from '../auth/auth.types';

export interface RoomView {
  code: string;
  hostId: string;
  status: RoomDoc['status'];
  maxPlayers: number;
  members: RoomMember[];
  gameId?: string;
}

export interface TicketResult {
  gameId: string;
  ticket: string;
}

const toView = (r: RoomDoc): RoomView => ({
  code: r._id,
  hostId: r.hostId,
  status: r.status,
  maxPlayers: r.maxPlayers,
  members: r.members,
  ...(r.gameId ? { gameId: r.gameId } : {}),
});

@Injectable()
export class LobbyService {
  constructor(
    private readonly rooms: RoomRepo,
    private readonly hub: GameHub,
    private readonly tokens: TokenService,
  ) {}

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

  async ready(code: string, user: AuthUser, ready: boolean): Promise<RoomView> {
    const r = await this.rooms.setReady(code, user.userId, ready);
    if (!r) throw new NotFoundException('room not found');
    return toView(r);
  }

  /** Host starts the game: create the authoritative match, mark the room STARTED, hand back a ticket. */
  async start(code: string, user: AuthUser): Promise<TicketResult> {
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
    const config: GameConfig = { seed, players, contentHash: CONTENT_HASH };

    if (!(await this.rooms.markStarted(code, user.userId, gameId, seed))) {
      throw new BadRequestException('could not start (already started?)');
    }
    await this.hub.createMatch(gameId, taiwanBoard(), config);
    return { gameId, ticket: this.ticketFor(gameId, user.userId, this.seatOf(room, user.userId)) };
  }

  /** Mint a ws-game ticket for the current member of a started room (initial + reconnect). */
  async ticket(code: string, user: AuthUser): Promise<TicketResult> {
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
