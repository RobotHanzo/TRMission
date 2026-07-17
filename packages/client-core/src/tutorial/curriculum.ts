// The authored lesson list. Each lesson is a scripted scenario over a real local engine game; the
// guided tutorial plays an ordered, scope-filtered subset and the encyclopedia exposes them as
// replayable entries. Robust mechanisms only: interactive beats use actions any starting hand can
// perform (keep tickets, draw a card) — the claim practice targets R42 (Pingtung–Chaozhou,
// GRAY length 1) and the station practice targets Taipei's first station (cost 1), both affordable
// with any single card. Both are `await` beats: the learner performs the real click themselves (the
// guided tutorial waits for it; the encyclopedia's read-only demo auto-performs it for the viewer —
// see `performAwait` in EncyclopediaModal.tsx).
import { asPlayerId, type SeatIndex } from '@trm/shared';
import type { Action, GameState } from '@trm/engine';
import type { Lesson, Scope } from './types';

const P0 = asPlayerId('you');
const P1 = asPlayerId('bot:rival');
const players = [
  { id: P0, seat: 0 as SeatIndex },
  { id: P1, seat: 1 as SeatIndex },
];

/** Keep a player's entire initial offer (always satisfies "keep ≥2" + "keep all long tickets"). */
const keepAll = (s: GameState, pid: typeof P0): Action => ({
  t: 'KEEP_INITIAL_TICKETS',
  player: pid,
  keep: [...(s.players[pid as string]?.pendingTicketOffer ?? [])],
});

/** Silent setup that fast-forwards past the ticket draft into AWAIT_ACTION (learner to act). */
const skipDraft = (s: GameState): Action[] => [keepAll(s, P0), keepAll(s, P1)];

export const LESSONS: Lesson[] = [
  {
    id: 'welcome',
    chapter: 0,
    titleKey: 'tutorial.welcome.title',
    blurbKey: 'tutorial.welcome.blurb',
    scopes: ['core', 'full'],
    kind: 'tutorial',
    seed: 'tut-welcome',
    players,
    viewer: P0 as string,
    beats: [
      { id: 'goal', text: 'tutorial.welcome.goal', mode: 'info' },
      {
        id: 'map',
        text: 'tutorial.welcome.map',
        mode: 'info',
        spotlight: { kind: 'hud', selector: '.board-viewport' },
      },
      { id: 'score', text: 'tutorial.welcome.score', mode: 'info' },
      {
        id: 'draft',
        text: 'tutorial.welcome.draft',
        mode: 'await',
        expect: { t: 'KEEP_INITIAL_TICKETS' },
        spotlight: { kind: 'hud', selector: '.ticket-chooser' },
      },
      {
        id: 'botdraft',
        text: 'tutorial.welcome.botdraft',
        mode: 'auto',
        action: (s) => keepAll(s, P1),
      },
    ],
  },
  {
    id: 'draw',
    chapter: 3,
    titleKey: 'tutorial.draw.title',
    blurbKey: 'tutorial.draw.blurb',
    scopes: ['core', 'full'],
    kind: 'both',
    seed: 'tut-draw',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [
      {
        id: 'intro',
        text: 'tutorial.draw.intro',
        mode: 'info',
        spotlight: { kind: 'hud', selector: '.market' },
        specimen: { kind: 'card-row' },
      },
      {
        id: 'do',
        text: 'tutorial.draw.do',
        mode: 'await',
        expect: { t: 'DRAW_ANY' },
        spotlight: { kind: 'hud', selector: '.market' },
      },
      {
        id: 'second',
        text: 'tutorial.draw.second',
        mode: 'await',
        expect: { t: 'DRAW_ANY' },
        spotlight: { kind: 'hud', selector: '.market' },
      },
      { id: 'loco', text: 'tutorial.draw.loco', mode: 'info', specimen: { kind: 'loco-card' } },
    ],
  },
  {
    id: 'claim',
    chapter: 4,
    titleKey: 'tutorial.claim.title',
    blurbKey: 'tutorial.claim.blurb',
    scopes: ['core', 'full'],
    kind: 'both',
    seed: 'tut-claim',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [
      { id: 'intro', text: 'tutorial.claim.intro', mode: 'info', specimen: { kind: 'claim-cost' } },
      {
        id: 'try',
        text: 'tutorial.claim.try',
        mode: 'await',
        expect: { t: 'CLAIM_ROUTE', routeId: 'R42' },
        spotlight: { kind: 'route', ids: ['R42'] },
        frame: { kind: 'route', ids: ['R42'] },
        specimen: { kind: 'route', variant: 'rail' },
      },
      { id: 'scored', text: 'tutorial.claim.scored', mode: 'info' },
      {
        id: 'table',
        text: 'tutorial.claim.table',
        mode: 'info',
        specimen: { kind: 'score-table' },
      },
    ],
  },
  {
    id: 'special',
    chapter: 5,
    titleKey: 'tutorial.special.title',
    blurbKey: 'tutorial.special.blurb',
    scopes: ['full'],
    kind: 'both',
    seed: 'tut-special',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [
      {
        id: 'intro',
        text: 'tutorial.special.intro',
        mode: 'info',
        specimen: { kind: 'routes-compare' },
      },
      {
        id: 'double',
        text: 'tutorial.special.double',
        mode: 'info',
        specimen: { kind: 'route', variant: 'double' },
        spotlight: { kind: 'route', ids: ['R48', 'R49'] },
        frame: { kind: 'route', ids: ['R48', 'R49'] },
      },
      {
        id: 'ferry',
        text: 'tutorial.special.ferry',
        mode: 'info',
        specimen: { kind: 'route', variant: 'ferry' },
        spotlight: { kind: 'route', ids: ['R26'] },
        frame: { kind: 'route', ids: ['R26'] },
      },
      {
        id: 'tunnel',
        text: 'tutorial.special.tunnel',
        mode: 'info',
        specimen: { kind: 'route', variant: 'tunnel' },
        spotlight: { kind: 'route', ids: ['R5'] },
        frame: { kind: 'route', ids: ['R5'] },
      },
      // Broken rail exists only on custom maps (no Taiwan route to spotlight/frame), so this beat
      // is specimen-only. The one-shot in-game FeatureIntro covers the first live encounter.
      {
        id: 'broken',
        text: 'tutorial.special.broken',
        mode: 'info',
        specimen: { kind: 'route', variant: 'broken' },
      },
    ],
  },
  {
    id: 'stations',
    chapter: 6,
    titleKey: 'tutorial.stations.title',
    blurbKey: 'tutorial.stations.blurb',
    scopes: ['full'],
    kind: 'both',
    seed: 'tut-stations',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [
      { id: 'what', text: 'tutorial.stations.what', mode: 'info', specimen: { kind: 'station' } },
      {
        id: 'cost',
        text: 'tutorial.stations.cost',
        mode: 'info',
        specimen: { kind: 'station-cost' },
      },
      {
        id: 'try',
        text: 'tutorial.stations.try',
        mode: 'await',
        expect: { t: 'BUILD_STATION', cityId: 'taipei' },
        spotlight: { kind: 'cities', ids: ['taipei'] },
        frame: { kind: 'cities', ids: ['taipei'] },
      },
      { id: 'bonus', text: 'tutorial.stations.bonus', mode: 'info' },
    ],
  },
  {
    id: 'tickets',
    chapter: 7,
    titleKey: 'tutorial.tickets.title',
    blurbKey: 'tutorial.tickets.blurb',
    scopes: ['core', 'full'],
    kind: 'both',
    seed: 'tut-tickets',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [
      {
        id: 'complete',
        text: 'tutorial.tickets.complete',
        mode: 'info',
        specimen: { kind: 'ticket', id: 'S14' },
      },
      { id: 'penalty', text: 'tutorial.tickets.penalty', mode: 'info' },
      {
        id: 'more',
        text: 'tutorial.tickets.more',
        mode: 'info',
        spotlight: { kind: 'hud', selector: '[data-anim="draw-tickets"]' },
      },
      { id: 'forced', text: 'tutorial.tickets.forced', mode: 'info' },
    ],
  },
  {
    id: 'longest',
    chapter: 8,
    titleKey: 'tutorial.longest.title',
    blurbKey: 'tutorial.longest.blurb',
    scopes: ['full'],
    kind: 'both',
    seed: 'tut-longest',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [{ id: 'trail', text: 'tutorial.longest.trail', mode: 'info' }],
  },
  {
    id: 'endgame',
    chapter: 9,
    titleKey: 'tutorial.endgame.title',
    blurbKey: 'tutorial.endgame.blurb',
    scopes: ['core', 'full'],
    kind: 'both',
    seed: 'tut-endgame',
    players,
    viewer: P0 as string,
    setup: skipDraft,
    beats: [
      { id: 'trigger', text: 'tutorial.endgame.trigger', mode: 'info' },
      {
        id: 'scoring',
        text: 'tutorial.endgame.scoring',
        mode: 'info',
        spotlight: { kind: 'hud', selector: '.trackers' },
      },
      { id: 'win', text: 'tutorial.endgame.win', mode: 'info' },
    ],
  },
];

/** The ordered guided-tutorial lessons for a chosen scope. */
export function lessonsForScope(scope: Scope): Lesson[] {
  return LESSONS.filter((l) => l.kind !== 'encyclopedia' && l.scopes.includes(scope));
}

/** Encyclopedia entries grouped by chapter (every lesson that opts into the index). */
export function encyclopediaEntries(): Lesson[] {
  return LESSONS.filter((l) => l.kind !== 'tutorial');
}
