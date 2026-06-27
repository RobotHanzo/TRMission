// Optional dev-only helper: seed a 2-player demo game on boot (TRM_DEV_GAME=1) and
// return dev tickets so you can connect two browser/ws clients and play manually
// before the REST lobby (Step C) exists.
import { taiwanBoard, CONTENT_HASH } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import type { GameHub } from './ws/hub';
import { makeDevTicket } from './ws/ticket';

export function seedDevGame(hub: GameHub): { gameId: string; tickets: Record<string, string> } {
  const gameId = 'dev-game';
  const players: PlayerSeed[] = [
    { id: asPlayerId('p1'), seat: 0 },
    { id: asPlayerId('p2'), seat: 1 },
  ];
  const config: GameConfig = { seed: 'dev-seed-1', players, contentHash: CONTENT_HASH };
  hub.createMatch(gameId, taiwanBoard(), config);

  const tickets: Record<string, string> = {};
  for (const p of players) {
    tickets[p.id as string] = makeDevTicket({ gameId, playerId: p.id as string, seat: p.seat });
  }
  return { gameId, tickets };
}
