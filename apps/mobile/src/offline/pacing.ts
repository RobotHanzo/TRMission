// Client-side bot pacing — port of apps/server/src/ws/bot-pacing.ts (same constants), so a
// bot resolving a tunnel holds long enough for the reveal animation to play out on screen.
import type { Phase } from '@trm/engine';

const TUNNEL_REVEAL_STAGGER_MS = 500;
const TUNNEL_REVEAL_FLIP_MS = 600;
const TUNNEL_REVEAL_RESULT_PAD_MS = 120;
const TUNNEL_RESULT_READ_MS = 1000;

/** Base pause before each bot move — a calm, human-ish cadence. */
export const BOT_STEP_MS = 900;

export function botPauseMs(phase: Phase, revealedCount: number): number {
  if (phase !== 'TUNNEL_PENDING') return BOT_STEP_MS;
  const revealMs =
    Math.max(0, revealedCount - 1) * TUNNEL_REVEAL_STAGGER_MS +
    TUNNEL_REVEAL_FLIP_MS +
    TUNNEL_REVEAL_RESULT_PAD_MS;
  return Math.max(BOT_STEP_MS, revealMs + TUNNEL_RESULT_READ_MS);
}
