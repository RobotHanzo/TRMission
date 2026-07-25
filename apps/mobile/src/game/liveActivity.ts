// Pure snapshot → Live Activity mapping (issue #43). No RN/expo imports, so it stays unit-testable
// off-device; the driver that actually talks to ActivityKit is `useLiveActivity.ts`.
//
// `LiveActivityContent` is a THREE-sided contract — this mapping, the Swift `ContentState`
// (modules/live-activity/ios/TRMissionActivityAttributes.swift), and the server's APNs
// `content-state` (apps/server/src/push/push.transports.ts) must agree field for field, because a
// backgrounded app's activity is updated by the server, not by this file.
import { Phase, type GameSnapshot } from '@trm/proto';
import { seatColor } from '../theme/colors';
import type { LiveActivityAttributes, LiveActivityContent } from '../../modules/live-activity';

/** Seat → display name, already localized and moderation-masked by the caller. */
export interface LiveActivitySeat {
  seat: number;
  name: string;
}

/**
 * The mutable half of the activity. `turnDeadlineMs` is the game store's client-local turn deadline
 * (`turnTimer.deadline`, ms) or null when nobody is on the clock — it becomes epoch SECONDS so the
 * widget can run its own countdown between updates.
 */
export const liveActivityContent = (
  snapshot: GameSnapshot,
  turnDeadlineMs: number | null,
): LiveActivityContent => {
  const over = snapshot.phase === Phase.GAME_OVER;
  const me = snapshot.you?.playerId;
  const mine = me ? snapshot.players.find((p) => p.id === me) : undefined;
  const current = over
    ? undefined
    : snapshot.players.find((p) => p.id === snapshot.currentPlayerId);
  return {
    currentSeat: current ? current.seat : -1,
    myTrains: mine?.trainCars ?? 0,
    myScore: mine?.routePoints ?? 0,
    // The last-round counter only means anything once the endgame has actually triggered.
    finalTurnsRemaining:
      !over && snapshot.endgame?.triggered ? snapshot.endgame.finalTurnsRemaining : 0,
    over,
    turnEndsAt: !over && turnDeadlineMs ? Math.round(turnDeadlineMs / 1000) : 0,
  };
};

/** Skip no-op ActivityKit calls: an activity update is a system-budgeted operation. */
export const sameLiveActivityContent = (
  a: LiveActivityContent | null,
  b: LiveActivityContent,
): boolean =>
  a !== null &&
  a.currentSeat === b.currentSeat &&
  a.myTrains === b.myTrains &&
  a.myScore === b.myScore &&
  a.finalTurnsRemaining === b.finalTurnsRemaining &&
  a.over === b.over &&
  // Second granularity: a re-broadcast countdown that lands on the same second is not news.
  a.turnEndsAt === b.turnEndsAt;

/**
 * One localized turn label per seat, indexed by seat — the widget renders `turnLabels[currentSeat]`
 * and never formats a string itself, which keeps all copy in i18next and lets the server push seat
 * numbers alone. Gaps (a seat the roster hasn't resolved) fall back to `otherLabel(P{seat+1})`.
 */
export const turnLabelsFor = (
  seats: LiveActivitySeat[],
  mySeat: number,
  yourLabel: string,
  otherLabel: (name: string) => string,
): string[] => {
  const highest = seats.reduce((max, s) => Math.max(max, s.seat), -1);
  const bySeat = new Map(seats.map((s) => [s.seat, s.name]));
  return Array.from({ length: highest + 1 }, (_, seat) =>
    seat === mySeat ? yourLabel : otherLabel(bySeat.get(seat) ?? `P${seat + 1}`),
  );
};

/** Static attributes, fixed for the life of one activity (seat colours come from the shared tokens). */
export const liveActivityAttributes = (args: {
  roomCode: string;
  mySeat: number;
  turnLabels: string[];
  strings: LiveActivityAttributes['strings'];
}): LiveActivityAttributes => ({
  turnLabels: args.turnLabels,
  seatColors: args.turnLabels.map((_, seat) => seatColor(seat)),
  mySeat: args.mySeat,
  roomCode: args.roomCode,
  strings: args.strings,
});
