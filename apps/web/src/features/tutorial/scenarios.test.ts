import { describe, it, expect } from 'vitest';
import { taiwanBoard, CONTENT_HASH, initGame, reduce, enumerateClaimPayments } from '@trm/engine';
import type { Action, Board, GameConfig, GameState } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import { LESSONS } from './curriculum';
import type { ExpectSpec, Lesson } from './types';
import { cityById, routeById, ticketById } from '../../game/content';
import { isAllowedHudSelector } from './focus';

// Replays every lesson through the REAL engine: setup actions, scripted `auto` actions, and a
// synthesized action for each `await` beat (so the chain stays in a valid state). Any rule, content
// or CONTENT_HASH change that breaks a scripted lesson fails here — not in front of a learner.

function synthAwait(
  expect: ExpectSpec,
  viewer: ReturnType<typeof asPlayerId>,
  s: GameState,
): Action {
  switch (expect.t) {
    case 'KEEP_INITIAL_TICKETS':
      return {
        t: 'KEEP_INITIAL_TICKETS',
        player: viewer,
        keep: [...(s.players[viewer as string]?.pendingTicketOffer ?? [])],
      };
    case 'KEEP_TICKETS':
      return {
        t: 'KEEP_TICKETS',
        player: viewer,
        keep: [...(s.players[viewer as string]?.pendingTicketOffer ?? [])].slice(0, 1),
      };
    case 'DRAW_ANY':
    case 'DRAW_BLIND':
      return { t: 'DRAW_BLIND', player: viewer };
    case 'DRAW_FACEUP':
      return {
        t: 'DRAW_FACEUP',
        player: viewer,
        slot: Math.max(
          0,
          s.market.findIndex((c) => c !== null),
        ),
      };
    case 'DRAW_TICKETS':
      return { t: 'DRAW_TICKETS', player: viewer };
    case 'PASS':
      return { t: 'PASS', player: viewer };
    default:
      throw new Error(`scenario test cannot synthesize await ${expect.t}`);
  }
}

function runLesson(lesson: Lesson, board: Board): GameState {
  const config: GameConfig = {
    seed: lesson.seed,
    players: lesson.players,
    contentHash: CONTENT_HASH,
    ...(lesson.ruleParams ? { ruleParams: lesson.ruleParams } : {}),
  };
  const viewer = asPlayerId(lesson.viewer);
  let state = initGame(board, config);

  const apply = (action: Action) => {
    const r = reduce(board, state, action);
    expect(r.ok, `${lesson.id}: action ${action.t} should be legal`).toBe(true);
    if (r.ok) state = r.value.state;
  };

  if (lesson.setup) for (const a of lesson.setup(state, board)) apply(a);

  for (const beat of lesson.beats) {
    if (beat.mode === 'auto') {
      apply(typeof beat.action === 'function' ? beat.action(state, board) : beat.action);
    } else if (beat.mode === 'await') {
      apply(synthAwait(beat.expect, viewer, state));
    }
  }
  return state;
}

describe('tutorial scenarios replay through the engine', () => {
  it('has unique lesson ids and beat ids', () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of LESSONS) {
      const beatIds = l.beats.map((b) => b.id);
      expect(new Set(beatIds).size, `${l.id} beat ids`).toBe(beatIds.length);
    }
  });

  for (const lesson of LESSONS) {
    it(`replays "${lesson.id}" with only legal actions`, () => {
      runLesson(lesson, taiwanBoard());
    });
  }

  it('the claim demo can actually afford R16 from the dealt hand', () => {
    const board = taiwanBoard();
    const lesson = LESSONS.find((l) => l.id === 'claim')!;
    const config: GameConfig = {
      seed: lesson.seed,
      players: lesson.players,
      contentHash: CONTENT_HASH,
    };
    let state = initGame(board, config);
    for (const a of lesson.setup!(state, board)) {
      const r = reduce(board, state, a);
      if (r.ok) state = r.value.state;
    }
    const route = board.content.routes.find((r) => (r.id as string) === 'R16')!;
    const pays = enumerateClaimPayments(board, state, asPlayerId(lesson.viewer), route);
    expect(pays.length).toBeGreaterThan(0);
  });
});

describe('tutorial beat visual references resolve to real content', () => {
  for (const lesson of LESSONS) {
    for (const beat of lesson.beats) {
      const sp = beat.spotlight;
      if (sp?.kind === 'cities') {
        it(`${lesson.id}/${beat.id} spotlight cities exist`, () => {
          for (const id of sp.ids) expect(cityById.get(id), id).toBeTruthy();
        });
      }
      if (sp?.kind === 'route') {
        it(`${lesson.id}/${beat.id} spotlight routes exist`, () => {
          for (const id of sp.ids) expect(routeById.get(id), id).toBeTruthy();
        });
      }
      if (sp?.kind === 'hud') {
        it(`${lesson.id}/${beat.id} hud selector is allow-listed`, () => {
          expect(isAllowedHudSelector(sp.selector), sp.selector).toBe(true);
        });
      }
      if (beat.frame) {
        it(`${lesson.id}/${beat.id} frame ids exist`, () => {
          for (const id of beat.frame!.ids) {
            const ok = beat.frame!.kind === 'route' ? routeById.get(id) : cityById.get(id);
            expect(ok, id).toBeTruthy();
          }
        });
      }
      if (beat.specimen?.kind === 'ticket') {
        it(`${lesson.id}/${beat.id} ticket specimen exists`, () => {
          expect(
            ticketById.get(beat.specimen!.kind === 'ticket' ? beat.specimen!.id : ''),
            'ticket',
          ).toBeTruthy();
        });
      }
    }
  }
});
