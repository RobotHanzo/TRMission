import { Phase, type GameSnapshot } from '@trm/proto';

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

/**
 * The whose-turn banner as an i18n key plus (for `turnOf`) the acting player's id + seat, so the
 * caller can resolve a real display name via the lobby roster rather than baking `P{seat+1}` here.
 */
export interface TurnStatus {
  key: 'gameOver' | 'yourTurn' | 'turnOf';
  player?: { id: string; seat: number };
}
export const turnStatus = (snap: GameSnapshot): TurnStatus => {
  if (snap.phase === Phase.GAME_OVER) return { key: 'gameOver' };
  if (isMyTurn(snap)) return { key: 'yourTurn' };
  const p = snap.players.find((pl) => pl.id === snap.currentPlayerId);
  return p ? { key: 'turnOf', player: { id: p.id, seat: p.seat } } : { key: 'turnOf' };
};
