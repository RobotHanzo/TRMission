// The tutorial's HUD interaction gate (ports the gate parts of apps/web/src/features/tutorial/
// types.ts — pure types + one function). An `await` beat exposes exactly the affordance it waits
// for; a narration/scripted beat — and the finished state — locks the HUD entirely ('locked'), so
// a stray tap can't consume the learner's turn and strand a later step. A live game passes no
// gate (undefined) → every affordance stays live. Dead until P4 passes one; the GameStage carries
// the prop now so the P3/P4 stages plug in without a contract change.

/** A declarative match against the learner's action for an `await` beat. `DRAW_ANY` accepts
 *  either a blind or a face-up draw. */
export type ExpectSpec =
  | { t: 'DRAW_ANY' | 'DRAW_BLIND' | 'DRAW_FACEUP' | 'DRAW_TICKETS' | 'PASS' }
  | { t: 'KEEP_TICKETS' | 'KEEP_INITIAL_TICKETS' }
  | { t: 'CLAIM_ROUTE'; routeId?: string }
  | { t: 'BUILD_STATION'; cityId?: string }
  | { t: 'RESOLVE_TUNNEL'; commit?: boolean };

export type ActionGate = ExpectSpec | 'locked';

/** Which learner affordances stay interactive under a gate. */
export interface GateFlags {
  draw: boolean;
  tickets: boolean;
  claim: boolean;
  station: boolean;
  keep: boolean;
  tunnel: boolean;
}

/** Resolve a beat's gate (or `undefined`/`null` for a live game) to per-affordance interactivity. */
export function gateFlags(gate: ActionGate | null | undefined): GateFlags {
  if (gate == null) {
    return { draw: true, tickets: true, claim: true, station: true, keep: true, tunnel: true };
  }
  if (gate === 'locked') {
    return {
      draw: false,
      tickets: false,
      claim: false,
      station: false,
      keep: false,
      tunnel: false,
    };
  }
  const t = gate.t;
  return {
    draw: t === 'DRAW_ANY' || t === 'DRAW_BLIND' || t === 'DRAW_FACEUP',
    tickets: t === 'DRAW_TICKETS',
    claim: t === 'CLAIM_ROUTE',
    station: t === 'BUILD_STATION',
    keep: t === 'KEEP_TICKETS' || t === 'KEEP_INITIAL_TICKETS',
    tunnel: t === 'RESOLVE_TUNNEL',
  };
}
