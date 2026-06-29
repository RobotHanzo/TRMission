// The data model shared by the interactive tutorial and the encyclopedia replays. A Lesson is a
// scripted scenario over a local @trm/engine game (driven by SandboxSocket); its `beats` are the
// narrated steps. A beat either waits for the learner to perform an action (`await`), auto-plays a
// scripted action (`auto`, used for opponent moves and demos), or is pure narration (`info`).
import type { Action, Board, GameConfig, GameState, PlayerSeed } from '@trm/engine';
import type { BoardFrameTarget } from '../../game/boardView';

export type Scope = 'core' | 'full';

/** What to visually emphasise while a beat is showing. The spotlight dims everything else. */
export type Spotlight =
  | { kind: 'cities'; ids: string[] }
  | { kind: 'route'; ids: string[] }
  | { kind: 'hud'; selector: string }
  | { kind: 'board' };

/** A rendered game-component specimen shown inside the coachmark (the visual glossary). */
export type SpecimenSpec =
  | { kind: 'routes-compare' }
  | { kind: 'route'; variant: 'rail' | 'ferry' | 'tunnel' | 'double' }
  | { kind: 'card-row' }
  | { kind: 'loco-card' }
  | { kind: 'station' }
  | { kind: 'score-table' }
  | { kind: 'ticket'; id: string };

/** A declarative match against the learner's action for an `await` beat. `DRAW_ANY` accepts either
 *  a blind or a face-up draw (so a "draw a card" step never traps the learner on which pile). */
export type ExpectSpec =
  | { t: 'DRAW_ANY' | 'DRAW_BLIND' | 'DRAW_FACEUP' | 'DRAW_TICKETS' | 'PASS' }
  | { t: 'KEEP_TICKETS' | 'KEEP_INITIAL_TICKETS' }
  | { t: 'CLAIM_ROUTE'; routeId?: string }
  | { t: 'BUILD_STATION'; cityId?: string }
  | { t: 'RESOLVE_TUNNEL'; commit?: boolean };

export type Beat = {
  id: string;
  /** i18n key under `tutorial.*` for the coachmark narration. */
  text: string;
  spotlight?: Spotlight | undefined;
  /** A component specimen rendered in the coachmark this beat. */
  specimen?: SpecimenSpec | undefined;
  /** Auto-pan the board to frame this target while the beat shows. */
  frame?: BoardFrameTarget | undefined;
} & (
  | { mode: 'info' }
  | { mode: 'await'; expect: ExpectSpec }
  | {
      mode: 'auto';
      action: Action | ((state: GameState, board: Board) => Action);
      delayMs?: number;
    }
);

export interface Lesson {
  id: string;
  chapter: number;
  titleKey: string;
  /** Short rules blurb shown by the encyclopedia entry. */
  blurbKey: string;
  scopes: Scope[];
  /** Whether this lesson is part of the guided tutorial, the encyclopedia index, or both. */
  kind: 'tutorial' | 'encyclopedia' | 'both';
  seed: string;
  players: PlayerSeed[];
  /** The learner's player id (whose redacted view is rendered). */
  viewer: string;
  ruleParams?: GameConfig['ruleParams'];
  /** Silent actions (computed from the freshly-dealt state) applied before the first beat — e.g.
   *  auto-keeping initial tickets so a lesson opens already in AWAIT_ACTION. */
  setup?: (state: GameState, board: Board) => Action[];
  beats: Beat[];
}

export function expectMatches(expect: ExpectSpec, action: Action): boolean {
  if (expect.t === 'DRAW_ANY') return action.t === 'DRAW_BLIND' || action.t === 'DRAW_FACEUP';
  if (action.t !== expect.t) return false;
  if (expect.t === 'CLAIM_ROUTE' && expect.routeId)
    return (action as { routeId: string }).routeId === expect.routeId;
  if (expect.t === 'BUILD_STATION' && expect.cityId)
    return (action as { cityId: string }).cityId === expect.cityId;
  if (expect.t === 'RESOLVE_TUNNEL' && expect.commit !== undefined)
    return (action as { commit: boolean }).commit === expect.commit;
  return true;
}
