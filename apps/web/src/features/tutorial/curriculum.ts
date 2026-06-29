// The authored lesson list. Each lesson is a scripted scenario over a real local engine game; the
// guided tutorial plays an ordered, scope-filtered subset and the encyclopedia exposes them as
// replayable entries. Robust mechanisms only: interactive beats use actions any starting hand can
// perform (keep tickets, draw a card), and the claim demo targets R16 (Hsinchu–Zhunan, GRAY length
// 1) which is affordable with any single card.
import { asPlayerId, type SeatIndex } from '@trm/shared';
import { enumerateClaimPayments } from '@trm/engine';
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
      { id: 'intro', text: 'tutorial.claim.intro', mode: 'info' },
      {
        id: 'demo',
        text: 'tutorial.claim.demo',
        mode: 'auto',
        delayMs: 1200,
        spotlight: { kind: 'cities', ids: ['hsinchu', 'zhunan'] },
        frame: { kind: 'route', ids: ['R16'] },
        specimen: { kind: 'route', variant: 'rail' },
        action: (s, board) => {
          const route = board.content.routes.find((r) => (r.id as string) === 'R16')!;
          const pays = enumerateClaimPayments(board, s, P0, route);
          return { t: 'CLAIM_ROUTE', player: P0, routeId: route.id, payment: pays[0]! };
        },
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
        spotlight: { kind: 'route', ids: ['R6', 'R7'] },
        frame: { kind: 'route', ids: ['R6', 'R7'] },
      },
      {
        id: 'ferry',
        text: 'tutorial.special.ferry',
        mode: 'info',
        specimen: { kind: 'route', variant: 'ferry' },
        spotlight: { kind: 'route', ids: ['R82'] },
        frame: { kind: 'route', ids: ['R82'] },
      },
      {
        id: 'tunnel',
        text: 'tutorial.special.tunnel',
        mode: 'info',
        specimen: { kind: 'route', variant: 'tunnel' },
        spotlight: { kind: 'route', ids: ['R18'] },
        frame: { kind: 'route', ids: ['R18'] },
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
        specimen: { kind: 'ticket', id: 'S1' },
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
