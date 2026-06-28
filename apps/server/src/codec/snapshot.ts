// RedactedView (engine projection) → GameSnapshot (proto). The engine's
// `redactFor` has ALREADY removed hidden information for the viewer; this codec
// only reshapes it onto the wire types. Crucially, every player maps to a
// counts-only PublicPlayerState, and the viewer's own secrets go into the
// disjoint `you` SelfView — so the wire layer cannot leak opponents' hands or
// tickets even if a future redaction bug slipped through (risk #1, defence in depth).
import { create } from '@bufbuild/protobuf';
import type { CardColor, Hand, PlayerId } from '@trm/shared';
import type { RedactedView, RedactedPlayer, RedactedPlayerFinal } from '@trm/engine';
import {
  GameSnapshotSchema,
  CardCountsSchema,
  type GameSnapshot,
  type CardCounts,
} from '@trm/proto';
import { cardOrNullToPb, phaseToPb } from './enums';

function handToCardCounts(hand: Hand): CardCounts {
  return create(CardCountsSchema, {
    red: hand.RED,
    orange: hand.ORANGE,
    yellow: hand.YELLOW,
    green: hand.GREEN,
    blue: hand.BLUE,
    purple: hand.PURPLE,
    black: hand.BLACK,
    white: hand.WHITE,
    locomotive: hand.LOCOMOTIVE,
  });
}

function publicPlayer(p: RedactedPlayer) {
  return {
    id: p.id as string,
    seat: p.seat,
    trainCars: p.trainCars,
    stationsRemaining: p.stationsRemaining,
    routePoints: p.routePoints,
    handCount: p.handCount,
    ticketCount: p.ticketCount,
  };
}

function finalProto(pf: RedactedPlayerFinal, keptTicketIds: readonly string[]) {
  return {
    playerId: pf.playerId as string,
    routePoints: pf.routePoints,
    ticketNet: pf.ticketNet,
    ticketsCompleted: pf.ticketsCompleted,
    stationsUsed: pf.stationsUsed,
    unusedStations: pf.unusedStations,
    stationBonus: pf.stationBonus,
    longestTrailLength: pf.longestTrailLength,
    longestBonus: pf.longestBonus,
    total: pf.total,
    keptTicketIds: [...keptTicketIds],
    completedTicketIds: pf.completedTicketIds.map((id) => id as string),
    longestTrailRouteIds: pf.longestTrailRouteIds.map((id) => id as string),
  };
}

/**
 * Project a RedactedView onto the wire. `stateVersion` is the engine actionSeq
 * (the reconnect / idempotency cursor, A7) which RedactedView itself does not carry.
 * `viewer` is null for a spectator (no `you`).
 */
export function viewToSnapshot(
  view: RedactedView,
  stateVersion: number,
  viewer: PlayerId | null,
): GameSnapshot {
  const discard = view.discard as Hand;
  const self = viewer === null ? undefined : view.players.find((p) => p.id === viewer);

  const ownership = Object.entries(view.ownership).map(([routeId, cell]) =>
    'owner' in cell
      ? { routeId, cell: { case: 'ownerPlayerId' as const, value: cell.owner as string } }
      : { routeId, cell: { case: 'locked' as const, value: true } },
  );

  const finalScores =
    view.finalScores === null
      ? undefined
      : {
          players: view.finalScores.players.map((pf) => {
            const rp = view.players.find((p) => p.id === pf.playerId);
            return finalProto(pf, rp?.keptTickets ?? []);
          }),
          ranking: view.finalScores.ranking.map((group) => ({
            playerIds: group.map((id) => id as string),
          })),
        };

  return create(GameSnapshotSchema, {
    stateVersion,
    schemaVersion: view.schemaVersion,
    contentHash: view.contentHash,
    phase: phaseToPb(view.phase),
    orderIndex: view.orderIndex,
    currentPlayerId: (view.currentPlayer as string | null) ?? '',
    turnOrder: view.turnOrder.map((id) => id as string),
    market: view.market.map((c) => cardOrNullToPb(c as CardColor | null)),
    deckCount: view.deckCount,
    discard: handToCardCounts(discard),
    ticketDeckLongCount: view.ticketDeckLongCount,
    ticketDeckShortCount: view.ticketDeckShortCount,
    ownership,
    stations: view.stations.map((s) => ({
      playerId: s.playerId as string,
      cityId: s.cityId as string,
    })),
    endgame: {
      triggered: view.endgame.triggered,
      triggerPlayerIndex: view.endgame.triggerPlayerIndex,
      finalTurnsRemaining: view.endgame.finalTurnsRemaining,
    },
    pendingTunnel:
      view.pendingTunnel === null
        ? undefined
        : {
            playerId: view.pendingTunnel.player as string,
            routeId: view.pendingTunnel.routeId as string,
            revealed: view.pendingTunnel.revealed.map((c) => cardOrNullToPb(c as CardColor)),
            extraRequired: view.pendingTunnel.extraRequired,
          },
    players: view.players.map(publicPlayer),
    // Finished tickets, public for all players (own-track completion). Kept off the
    // counts-only PublicPlayerState so the risk #1 invariant holds.
    completedTickets: view.completedTickets.map((c) => ({
      playerId: c.player as string,
      ticketId: c.ticket as string,
    })),
    you:
      self === undefined || self.hand === null
        ? undefined
        : {
            playerId: self.id as string,
            hand: handToCardCounts(self.hand),
            keptTicketIds: (self.keptTickets ?? []).map((id) => id as string),
            pendingOfferTicketIds: (self.pendingTicketOffer ?? []).map((id) => id as string),
          },
    finalScores,
  });
}
