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

const seatLabel = (snap: GameSnapshot, id: string | undefined): string => {
  const p = snap.players.find((pl) => pl.id === id);
  return p ? `P${p.seat + 1}` : '';
};

/** The whose-turn banner as an i18n key + params, so any view can render it via t(). */
export interface TurnStatus {
  key: 'gameOver' | 'yourTurn' | 'turnOf';
  params?: { name: string };
}
export const turnStatus = (snap: GameSnapshot): TurnStatus => {
  if (snap.phase === Phase.GAME_OVER) return { key: 'gameOver' };
  if (isMyTurn(snap)) return { key: 'yourTurn' };
  return { key: 'turnOf', params: { name: seatLabel(snap, snap.currentPlayerId) } };
};
