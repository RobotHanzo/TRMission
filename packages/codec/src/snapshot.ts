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
import { randomEventsToPb } from './random-events';

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
    bentoTokens: p.bentoTokens,
    blessings: p.blessings,
    claimDiscounts: p.claimDiscounts,
    repairPermits: p.repairPermits,
    // Team id is public table information; -1 encodes "free-for-all" since proto3 uint32 cannot.
    team: p.team ?? -1,
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
    eventBonus: pf.eventBonus ?? 0,
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
          // Team totals + ranking (empty arrays in a free-for-all game).
          teams: (view.finalScores.teams ?? []).map((tf) => ({
            team: tf.team,
            memberIds: tf.members.map((id) => id as string),
            routePoints: tf.routePoints,
            ticketNet: tf.ticketNet,
            ticketsCompleted: tf.ticketsCompleted,
            stationBonus: tf.stationBonus,
            longestTrailLength: tf.longestTrailLength,
            longestBonus: tf.longestBonus,
            eventBonus: tf.eventBonus ?? 0,
            total: tf.total,
          })),
          teamRanking: (view.finalScores.teamRanking ?? []).map((group) => ({
            teams: [...group],
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
            playedColor: cardOrNullToPb(view.pendingTunnel.playedColor as CardColor | null),
          },
    players: view.players.map(publicPlayer),
    // Finished tickets, public for all players (own-track completion). Kept off the
    // counts-only PublicPlayerState so the risk #1 invariant holds.
    completedTickets: view.completedTickets.map((c) => ({
      playerId: c.player as string,
      ticketId: c.ticket as string,
    })),
    gameSettings: {
      unlimitedStationBorrow: view.settings.unlimitedStationBorrow,
      secondDrawAfterBlindRainbow: view.settings.secondDrawAfterBlindRainbow,
      noUnfinishedTicketPenalty: view.settings.noUnfinishedTicketPenalty,
      doubleRouteSingleFor23: view.settings.doubleRouteSingleFor23,
      eventsMode: view.settings.eventsMode,
      teamCount: view.settings.teamCount,
    },
    // Team rosters + public pools (unset in a free-for-all). Public to players AND spectators —
    // the pool is the signalling channel that replaces table talk, so everyone must read it.
    teams:
      view.teams === undefined
        ? undefined
        : {
            capacity: view.teams.capacity,
            pools: view.teams.rosters.map((members, team) => ({
              team,
              memberIds: members.map((id) => id as string),
              cards: handToCardCounts((view.teams?.pools[team] ?? {}) as Hand),
            })),
          },
    // Random-events projection (unset when the feature is off — `view.events` is absent).
    randomEvents: view.events === undefined ? undefined : randomEventsToPb(view.events),
    // Broken-rail repair records (public; empty until the first repair happens).
    brokenRails: Object.entries(view.brokenRails ?? {}).map(([routeId, repair]) => ({
      routeId,
      repairedByPlayerId: repair.by as string,
      exclusiveTurnEnds: repair.exclusiveTurnEnds,
    })),
    you:
      self === undefined || self.hand === null
        ? undefined
        : {
            playerId: self.id as string,
            hand: handToCardCounts(self.hand),
            keptTicketIds: (self.keptTickets ?? []).map((id) => id as string),
            pendingOfferTicketIds: (self.pendingTicketOffer ?? []).map((id) => id as string),
            youMustPass: view.youMustPass,
            // Teammates' kept tickets ride in the owner-addressed SelfView, never on the
            // counts-only PublicPlayerState. `redactFor` already decided visibility: a teammate's
            // keptTickets is non-null exactly when this viewer is allowed to see it.
            teammates: view.players
              .filter(
                (p) => p.id !== self.id && p.team !== null && p.team === self.team && p.keptTickets,
              )
              .map((p) => ({
                playerId: p.id as string,
                keptTicketIds: (p.keptTickets ?? []).map((id) => id as string),
              })),
            teamPushUsed: view.teams?.youPushedThisTurn ?? false,
          },
    finalScores,
  });
}
