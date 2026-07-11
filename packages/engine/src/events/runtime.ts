import type { PlayerId } from '@trm/shared';
import type { Board } from '../board';
import type { GameState } from '../types/state';
import type { GameEvent } from '../types/events';
import type {
  EventsState,
  ActiveEvent,
  CharterContract,
  EventScheduleEntry,
  LuckyContract,
} from '../types/events-state';
import { refillMarket } from '../deck';
import { addCardToHand, withPlayer } from '../reducers/common';
import { citiesConnected } from '../graph/connectivity';
import { longestTrail } from '../graph/longestTrail';
import { playerOwnEdges } from './effects';
import { drawEventCard, applyEventRefill } from './draw';

/** Advance the random-event timeline at a round boundary. */
export function tickRound(
  board: Board,
  state: GameState,
): { state: GameState; events: GameEvent[] } {
  const ev0 = state.events;
  if (!ev0) return { state, events: [] };
  const roundIndex = ev0.roundIndex;
  const events: GameEvent[] = [];

  let ev: EventsState = ev0;
  let next: GameState = state;

  // ── END / per-round movement ──
  const stillActive: ActiveEvent[] = [];
  const reopenBonus = [...ev.reopenBonus];
  let repairedRouteIds = [...ev.repairedRouteIds];
  for (const act of ev.active) {
    if (act.endsAfterRound < roundIndex) {
      events.push({ e: 'EVENT_ENDED', id: act.id, kind: act.kind, visibility: 'PUBLIC' });
      if (act.kind === 'TYPHOON_LANDFALL' && act.routeIds) {
        for (const rid of act.routeIds) {
          if (!next.ownership[rid as string] && !reopenBonus.includes(rid)) reopenBonus.push(rid);
        }
      }
      if (act.kind === 'SLOPE_REPAIR_ORDER' && act.routeIds) {
        const ended = new Set(act.routeIds as readonly string[]);
        repairedRouteIds = repairedRouteIds.filter((rid) => !ended.has(rid as string));
      }
      continue;
    }

    if (act.kind === 'GODDESS_PROCESSION' && act.cityPath && act.cityPath.length > 0) {
      const position = Math.min((act.position ?? 0) + 1, act.cityPath.length - 1);
      const moved = { ...act, position };
      stillActive.push(moved);
      const cityId = act.cityPath[position];
      if (cityId !== undefined) {
        events.push({
          e: 'EVENT_MARKER_MOVED',
          kind: 'GODDESS_PROCESSION',
          id: act.id,
          cityId,
          position,
          visibility: 'PUBLIC',
        });
      }
    } else {
      stillActive.push(act);
    }
  }

  const charters: CharterContract[] = ev.charters.filter(
    (c) => c.wonBy !== null || c.expiresAfterRound >= roundIndex,
  );
  const freeStationExpired = ev.freeStation !== undefined && ev.freeStation.untilRound < roundIndex;
  ev = { ...ev, active: stillActive, reopenBonus, repairedRouteIds, charters };
  if (freeStationExpired) ev = stripOptional(ev, 'freeStation');
  // Card helpers update `next.events` (for the hidden boring-machine marker). Keep the live state
  // synchronized with the END-pass result before any start-of-round effect can draw cards;
  // otherwise a gala/harvest draw would start from `ev0` and could resurrect an expired flag or
  // discard a freshly-created reopen bonus.
  next = { ...next, events: ev };

  // ── START ──
  let nextIdx = ev.nextIdx;
  const suppressed = [...ev.suppressed];
  const quiet = isQuietEndgame(next);
  const active = [...ev.active];
  let hotspots: Record<string, number> = { ...ev.hotspots };
  const openCharters: CharterContract[] = [...ev.charters];
  const luckyContracts: LuckyContract[] = [...ev.luckyContracts];

  while (
    nextIdx < ev.schedule.length &&
    (ev.schedule[nextIdx] as EventScheduleEntry).startRound === roundIndex
  ) {
    // Custom schedules may contain more than one entry at a round. Persist any stateful changes
    // made by the previous start before this entry invokes a shared card-draw/refill helper.
    next = { ...next, events: ev };
    const entry = ev.schedule[nextIdx] as EventScheduleEntry;
    if (!entry.telegraphed && quiet) {
      suppressed.push(entry.id);
      nextIdx++;
      continue;
    }

    events.push({
      e: 'EVENT_STARTED',
      id: entry.id,
      kind: entry.kind,
      startRound: entry.startRound,
      durationRounds: entry.durationRounds,
      ...(entry.routeIds ? { routeIds: entry.routeIds } : {}),
      ...(entry.region !== undefined ? { region: entry.region } : {}),
      ...(entry.cityId !== undefined ? { cityId: entry.cityId } : {}),
      ...(entry.charter ? { charter: entry.charter } : {}),
      ...(entry.cityPath ? { cityPath: entry.cityPath } : {}),
      ...(entry.pair ? { pair: entry.pair } : {}),
      visibility: 'PUBLIC',
    });

    if (entry.kind === 'RAILWAY_GALA') {
      for (const pid of next.turnOrder) {
        const draw = drawEventCard(next);
        next = draw.state;
        if (next.events) ev = next.events;
        events.push(...draw.events);
        if (draw.card === null) break;
        next = addCardToHand(next, pid as PlayerId, draw.card);
        events.push({
          e: 'CARD_DRAWN_BLIND',
          player: pid as PlayerId,
          card: draw.card,
          visibility: { private: pid as PlayerId },
        });
      }
      ev = { ...ev, freeStation: { untilRound: roundIndex } };
    } else if (entry.kind === 'VIRAL_HOTSPOT' && entry.cityId !== undefined) {
      const key = entry.cityId as string;
      hotspots = { ...hotspots, [key]: Math.min(2, (hotspots[key] ?? 0) + 1) };
    } else if (entry.kind === 'CHARTER_SPECIAL' && entry.charter) {
      const contract: CharterContract = {
        id: entry.id,
        a: entry.charter.a,
        b: entry.charter.b,
        points: entry.charter.points,
        expiresAfterRound: roundIndex + entry.durationRounds - 1,
        wonBy: null,
      };
      const winner = firstConnectedPlayer(board, next, contract.a as string, contract.b as string);
      if (winner !== null) {
        next = awardRoutePoints(next, winner, contract.points);
        openCharters.push({ ...contract, wonBy: winner });
        events.push({
          e: 'EVENT_BONUS',
          kind: 'CHARTER_SPECIAL',
          reason: 'CHARTER',
          player: winner,
          points: contract.points,
          visibility: 'PUBLIC',
        });
      } else openCharters.push(contract);
    } else if (entry.kind === 'LANTERN_HOST_CITY' && entry.cityId !== undefined) {
      ev = {
        ...ev,
        lanternHost: { eventId: entry.id, cityId: entry.cityId, points: 6 },
      };
    } else if (entry.kind === 'ROLLING_STOCK_ALLOCATION_DAY') {
      const resumeOrderIndex = next.turn.orderIndex;
      const order = [...next.turnOrder].sort((a, b) => {
        const pa = next.players[a as string]?.routePoints ?? 0;
        const pb = next.players[b as string]?.routePoints ?? 0;
        if (pa !== pb) return pa - pb;
        return next.turnOrder.indexOf(b) - next.turnOrder.indexOf(a);
      });
      if (order.length > 0) {
        ev = {
          ...ev,
          eventDraft: { eventId: entry.id, order, pickIndex: 0, resumeOrderIndex, picks: [] },
        };
        next = {
          ...next,
          turn: {
            orderIndex: next.turnOrder.indexOf(order[0] as PlayerId),
            phase: 'EVENT_DRAFT',
            cardsDrawnThisTurn: 0,
          },
        };
      }
    } else if (entry.kind === 'BREAKTHROUGH_BORING_MACHINE') {
      if (next.deck.length > 0) {
        const bottomThird = Math.max(1, Math.floor(next.deck.length / 3));
        const indexFromBottom = (entry.markerSelector ?? 0) % bottomThird;
        ev = {
          ...ev,
          boringMachine: {
            eventId: entry.id,
            remainingDraws: next.deck.length - indexFromBottom,
          },
        };
      } else {
        events.push({
          e: 'EVENT_ENDED',
          id: entry.id,
          kind: entry.kind,
          visibility: 'PUBLIC',
        });
      }
    } else if (entry.kind === 'INTERIM_OPERATIONS_REPORT') {
      const trailByPlayer = new Map<PlayerId, number>();
      let maxTrail = 0;
      for (const pid of next.turnOrder) {
        const edges = ownedTrailEdges(board, next, pid);
        const length = longestTrail(edges);
        trailByPlayer.set(pid, length);
        maxTrail = Math.max(maxTrail, length);
      }
      for (const pid of next.turnOrder) {
        const claimed = ownedRouteCount(next, pid);
        const routeBonus = Math.floor(claimed / 3);
        if (routeBonus > 0) {
          next = awardRoutePoints(next, pid, routeBonus);
          events.push({
            e: 'EVENT_BONUS',
            kind: entry.kind,
            reason: 'INTERIM_ROUTES',
            player: pid,
            points: routeBonus,
            visibility: 'PUBLIC',
          });
        }
        if (maxTrail > 0 && trailByPlayer.get(pid) === maxTrail) {
          next = awardRoutePoints(next, pid, 3);
          events.push({
            e: 'EVENT_BONUS',
            kind: entry.kind,
            reason: 'INTERIM_TRAIL',
            player: pid,
            points: 3,
            visibility: 'PUBLIC',
          });
        }
      }
    } else if (entry.kind === 'LUCKY_TICKET_STUB' && entry.pair) {
      const contract: LuckyContract = {
        id: entry.id,
        a: entry.pair.a,
        b: entry.pair.b,
        points: 5,
        wonBy: null,
      };
      const winner = firstConnectedPlayer(board, next, contract.a as string, contract.b as string);
      if (winner !== null) {
        next = awardRoutePoints(next, winner, contract.points);
        luckyContracts.push({ ...contract, wonBy: winner });
        events.push({
          e: 'EVENT_BONUS',
          kind: entry.kind,
          reason: 'LUCKY',
          player: winner,
          points: contract.points,
          visibility: 'PUBLIC',
        });
      } else luckyContracts.push(contract);
    }

    if (entry.kind === 'SLOPE_REPAIR_ORDER' && entry.routeIds) {
      const targets = new Set(entry.routeIds as readonly string[]);
      repairedRouteIds = repairedRouteIds.filter((rid) => !targets.has(rid as string));
    }

    if (entry.durationRounds > 0) {
      active.push({
        id: entry.id,
        kind: entry.kind,
        endsAfterRound: roundIndex + entry.durationRounds - 1,
        ...(entry.routeIds ? { routeIds: entry.routeIds } : {}),
        ...(entry.region !== undefined ? { region: entry.region } : {}),
        ...(entry.cityId !== undefined ? { cityId: entry.cityId } : {}),
        ...(entry.cityPath ? { cityPath: entry.cityPath, position: 0 } : {}),
        ...(entry.pair ? { pair: entry.pair } : {}),
      });
    }

    if (entry.kind === 'HARVEST_FESTIVAL_EXPRESS') {
      next = { ...next, events: ev };
      const refill = refillMarket(
        next.market,
        next.deck,
        next.discard,
        next.rng,
        next.ruleParams,
        true,
      );
      const applied = applyEventRefill(next, refill);
      next = applied.state;
      if (next.events) ev = next.events;
      events.push(...applied.events);
      if (refill.recycled) {
        events.push({ e: 'MARKET_REFILLED', market: refill.market, visibility: 'PUBLIC' });
      }
    }

    nextIdx++;
  }

  ev = {
    ...ev,
    nextIdx,
    suppressed,
    active,
    hotspots,
    charters: openCharters,
    luckyContracts,
    repairedRouteIds,
  };
  next = { ...next, events: ev };

  // ── ANNOUNCE ──
  const forecast = ev.schedule[nextIdx] as EventScheduleEntry | undefined;
  if (forecast && forecast.telegraphed && forecast.startRound === roundIndex + 1) {
    if (isQuietEndgame(next)) {
      ev = { ...ev, suppressed: [...ev.suppressed, forecast.id], nextIdx: ev.nextIdx + 1 };
      next = { ...next, events: ev };
    } else {
      events.push({
        e: 'EVENT_ANNOUNCED',
        id: forecast.id,
        kind: forecast.kind,
        startRound: forecast.startRound,
        durationRounds: forecast.durationRounds,
        ...(forecast.routeIds ? { routeIds: forecast.routeIds } : {}),
        ...(forecast.region !== undefined ? { region: forecast.region } : {}),
        ...(forecast.cityId !== undefined ? { cityId: forecast.cityId } : {}),
        ...(forecast.cityPath ? { cityPath: forecast.cityPath } : {}),
        ...(forecast.pair ? { pair: forecast.pair } : {}),
        visibility: 'PUBLIC',
      });
    }
  }

  return { state: next, events };
}

export function isQuietEndgame(state: GameState): boolean {
  if (state.endgame.triggered) return true;
  let min = Infinity;
  for (const p of Object.values(state.players)) if (p.trainCars < min) min = p.trainCars;
  return min <= state.ruleParams.endgameTrainThreshold + 8;
}

function firstConnectedPlayer(
  board: Board,
  state: GameState,
  a: string,
  b: string,
): PlayerId | null {
  for (const pid of state.turnOrder) {
    if (citiesConnected(playerOwnEdges(board, state, pid), a, b)) return pid;
  }
  return null;
}

function awardRoutePoints(state: GameState, player: PlayerId, points: number): GameState {
  return withPlayer(state, player, (p) => ({ ...p, routePoints: p.routePoints + points }));
}

function ownedRouteCount(state: GameState, player: PlayerId): number {
  let count = 0;
  for (const cell of Object.values(state.ownership)) {
    if ('owner' in cell && cell.owner === player) count++;
  }
  return count;
}

function ownedTrailEdges(board: Board, state: GameState, player: PlayerId) {
  const edges: { u: string; v: string; w: number }[] = [];
  for (const [routeId, cell] of Object.entries(state.ownership)) {
    if (!('owner' in cell) || cell.owner !== player) continue;
    const route = board.routeById.get(routeId);
    if (route) edges.push({ u: route.a as string, v: route.b as string, w: route.length });
  }
  return edges;
}

function stripOptional<K extends 'freeStation'>(ev: EventsState, key: K): EventsState {
  if (key === 'freeStation') {
    const { freeStation: _omit, ...rest } = ev;
    return rest;
  }
  return ev;
}
