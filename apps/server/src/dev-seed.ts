// Optional dev-only helper: seed a 2-player demo game on boot (TRM_DEV_GAME=1) and
// return signed ws-game tickets so you can connect two ws clients and play manually.
import { buildBoard } from '@trm/engine';
import type { GameConfig, PlayerSeed } from '@trm/engine';
import { OFFICIAL_MAPS } from '@trm/map-data';
import { asPlayerId } from '@trm/shared';
import type { GameHub } from './ws/hub';
import type { TokenService } from './auth/token.service';

export async function seedDevGame(
  hub: GameHub,
  tokens: TokenService,
): Promise<{ gameId: string; tickets: Record<string, string> }> {
  const gameId = 'dev-game';
  const players: PlayerSeed[] = [
    { id: asPlayerId('p1'), seat: 0 },
    { id: asPlayerId('p2'), seat: 1 },
  ];
  const officialMap = OFFICIAL_MAPS[0];
  if (!officialMap) throw new Error('no official maps registered');
  const config: GameConfig = { seed: 'dev-seed-1', players, contentHash: officialMap.hash };
  await hub.createMatch(gameId, buildBoard(officialMap.content), config);

  const ticketMap: Record<string, string> = {};
  for (const p of players) {
    ticketMap[p.id as string] = tokens.signWsTicket({
      gameId,
      playerId: p.id as string,
      seat: p.seat,
    });
  }
  return { gameId, tickets: ticketMap };
}
