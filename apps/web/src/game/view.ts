import type { GameSnapshot } from '@trm/proto';

export interface OwnershipInfo {
  ownerSeat?: number;
  locked?: boolean;
}

export const seatByPlayer = (snap: GameSnapshot): Map<string, number> =>
  new Map(snap.players.map((p) => [p.id, p.seat]));

export function ownershipMap(snap: GameSnapshot): Map<string, OwnershipInfo> {
  const seats = seatByPlayer(snap);
  const m = new Map<string, OwnershipInfo>();
  for (const o of snap.ownership) {
    if (o.cell.case === 'ownerPlayerId')
      m.set(o.routeId, { ownerSeat: seats.get(o.cell.value) ?? 0 });
    else if (o.cell.case === 'locked') m.set(o.routeId, { locked: true });
  }
  return m;
}

export const myId = (snap: GameSnapshot): string | null => snap.you?.playerId ?? null;
export const isMyTurn = (snap: GameSnapshot): boolean =>
  !!snap.you && snap.currentPlayerId === snap.you.playerId;
