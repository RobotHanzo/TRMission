import type { PlayerId } from '@trm/shared';
import type { Board } from '../board';
import type { GameState } from '../types/state';
import type { GameEvent } from '../types/events';
import type {
  EventsState,
  ActiveEvent,
  CharterContract,
  EventScheduleEntry,
} from '../types/events-state';
import { drawOne } from '../deck';
import { addCardToHand } from '../reducers/common';

/**
 * Round tick for the random-events feature. Runs ONCE per round boundary (an `endTurn` order wrap),
 * and ONLY when `state.events` exists.
 *
 * roundIndex ownership: the CALLER (`endTurn`) increments `state.events.roundIndex` BEFORE calling
 * `tickRound`, so on entry `roundIndex` already holds the round about to be played. `tickRound` reads
 * that value and never mutates it.
 *
 * Three phases, emitted in this order (matching the endTurn batch contract):
 *   a. END      — expire actives / charters / the free-station window; typhoon routes still unclaimed
 *                 at expiry roll into `reopenBonus`. Emits EVENT_ENDED per ended active.
 *   b. START    — begin every schedule entry whose startRound === roundIndex, applying its instant
 *                 state transition (gala blind draws, hotspot bump, charter open, active window).
 *                 A surprise (non-telegraphed) entry is suppressed if the game is in quiet-endgame.
 *                 Emits EVENT_STARTED (+ any gala draw events) per started entry.
 *   c. ANNOUNCE — telegraph the next entry one round early (startRound === roundIndex + 1). Suppressed
 *                 if quiet-endgame; otherwise emits EVENT_ANNOUNCED. nextIdx is NOT advanced for an
 *                 announced entry — it stays put and is picked up by START next round (the announce
 *                 condition can only be true one round before start, so it is never re-announced).
 *
 * M1 lands only the schedule bookkeeping + these notifications; the rule EFFECTS (closures,
 * surcharges, bonus awards, zero-cost stations) arrive in M2/M3.
 */
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

  // ── (a) END ──
  const stillActive: ActiveEvent[] = [];
  let reopenBonus = [...ev.reopenBonus];
  for (const act of ev.active) {
    if (act.endsAfterRound < roundIndex) {
      events.push({ e: 'EVENT_ENDED', id: act.id, kind: act.kind, visibility: 'PUBLIC' });
      if (act.kind === 'TYPHOON_LANDFALL' && act.routeIds) {
        for (const rid of act.routeIds) {
          if (!next.ownership[rid as string] && !reopenBonus.includes(rid)) reopenBonus.push(rid);
        }
      }
    } else {
      stillActive.push(act);
    }
  }
  let active = stillActive;
  const charters: CharterContract[] = ev.charters.filter(
    (c) => c.wonBy !== null || c.expiresAfterRound >= roundIndex,
  );
  const freeStationExpired = ev.freeStation !== undefined && ev.freeStation.untilRound < roundIndex;

  // `...ev` already carries `freeStation` when present; drop the key entirely once expired
  // (exactOptionalPropertyTypes / digest hygiene).
  ev = { ...ev, active, reopenBonus, charters };
  if (freeStationExpired) ev = stripFreeStation(ev);

  // ── (b) START ──
  let nextIdx = ev.nextIdx;
  const suppressed = [...ev.suppressed];
  const quiet = isQuietEndgame(next);
  active = [...ev.active];
  reopenBonus = [...ev.reopenBonus];
  let hotspots: Record<string, number> = { ...ev.hotspots };
  const openCharters: CharterContract[] = [...ev.charters];

  while (nextIdx < ev.schedule.length && (ev.schedule[nextIdx] as EventScheduleEntry).startRound === roundIndex) {
    const entry = ev.schedule[nextIdx] as EventScheduleEntry;
    // Surprise (non-telegraphed) entries are quiet-endgame checked here; telegraphed ones were
    // already checked (and either announced or suppressed) at announce time, so once they reach
    // START they always begin.
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
      visibility: 'PUBLIC',
    });

    // Instant state transitions.
    if (entry.kind === 'RAILWAY_GALA') {
      // Every player, in turn order, draws one blind card via the shared deck helper — emitting the
      // same CARD_DRAWN_BLIND (+ DECK_RESHUFFLED) shapes the draw reducers produce.
      for (const pid of next.turnOrder) {
        const d = drawOne(next.deck, next.discard, next.rng);
        if (d.card === null) break; // draw pool fully exhausted — stop dealing.
        if (d.reshuffled) events.push({ e: 'DECK_RESHUFFLED', visibility: 'PUBLIC' });
        next = { ...next, deck: d.deck, discard: d.discard, rng: d.rng };
        next = addCardToHand(next, pid as PlayerId, d.card);
        events.push({
          e: 'CARD_DRAWN_BLIND',
          player: pid as PlayerId,
          card: d.card,
          visibility: { private: pid as PlayerId },
        });
      }
    } else if (entry.kind === 'VIRAL_HOTSPOT') {
      if (entry.cityId !== undefined) {
        const key = entry.cityId as string;
        hotspots = { ...hotspots, [key]: Math.min(2, (hotspots[key] ?? 0) + 1) };
      }
    } else if (entry.kind === 'CHARTER_SPECIAL') {
      if (entry.charter) {
        openCharters.push({
          id: entry.id,
          a: entry.charter.a,
          b: entry.charter.b,
          points: entry.charter.points,
          expiresAfterRound: roundIndex + entry.durationRounds - 1,
          wonBy: null,
        });
      }
    }

    // Windowed kinds carry an ActiveEvent for their whole duration. HOTSPOT (permanent, lives in
    // `hotspots`) and CHARTER (lives in `charters`) are NOT ActiveEvents.
    if (entry.kind !== 'VIRAL_HOTSPOT' && entry.kind !== 'CHARTER_SPECIAL') {
      active.push({
        id: entry.id,
        kind: entry.kind,
        endsAfterRound: roundIndex + entry.durationRounds - 1,
        ...(entry.routeIds ? { routeIds: entry.routeIds } : {}),
        ...(entry.region !== undefined ? { region: entry.region } : {}),
      });
    }

    // Gala flags a one-round zero-cost-station window (the RULE lands in M3; here only the flag).
    if (entry.kind === 'RAILWAY_GALA') {
      ev = { ...ev, freeStation: { untilRound: roundIndex + 1 } };
    }

    nextIdx++;
  }

  ev = { ...ev, nextIdx, suppressed, active, reopenBonus, hotspots, charters: openCharters };

  // ── (c) ANNOUNCE ──
  const forecast = ev.schedule[nextIdx] as EventScheduleEntry | undefined;
  if (forecast && forecast.telegraphed && forecast.startRound === roundIndex + 1) {
    if (isQuietEndgame(next)) {
      // Suppress a surprise-of-the-future we will never surface: skip it entirely.
      ev = { ...ev, suppressed: [...ev.suppressed, forecast.id], nextIdx: ev.nextIdx + 1 };
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
        visibility: 'PUBLIC',
      });
    }
  }

  next = { ...next, events: ev };
  return { state: next, events };
}

/**
 * Quiet-endgame predicate (pure): true once the game is winding down, so no fresh surprise event is
 * introduced. `endgame.triggered` OR the lowest train-car count is within 8 of the endgame threshold.
 */
export function isQuietEndgame(state: GameState): boolean {
  if (state.endgame.triggered) return true;
  let min = Infinity;
  for (const p of Object.values(state.players)) if (p.trainCars < min) min = p.trainCars;
  return min <= state.ruleParams.endgameTrainThreshold + 8;
}

/** Return a copy of the events state with the `freeStation` key omitted entirely. */
function stripFreeStation(ev: EventsState): EventsState {
  const { freeStation: _freeStation, ...rest } = ev;
  return rest;
}
