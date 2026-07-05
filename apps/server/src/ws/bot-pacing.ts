import type { Phase } from '@trm/engine';

// Mirrors apps/web/src/components/TunnelModal.tsx's reveal timing (cards flip in staggered,
// then a short pad before the result is shown) so a bot doesn't resolve its tunnel before
// spectators have watched the reveal animation play out.
const TUNNEL_REVEAL_STAGGER_MS = 500;
const TUNNEL_REVEAL_FLIP_MS = 600;
const TUNNEL_REVEAL_RESULT_PAD_MS = 120;
// Extra time to let players read the surcharge/result before the turn moves on.
const TUNNEL_RESULT_READ_MS = 1000;

/**
 * How long the bot driver should pause before a bot's next move. Ordinarily just the
 * configured pacing delay, but a bot resolving a pending tunnel holds long enough for the
 * client-only reveal animation (scaled to however many cards were actually revealed) plus a
 * readability buffer, so the modal doesn't flicker shut on human spectators. Pacing being off
 * (`botMoveDelayMs` 0, as in tests) always wins and disables the hold too.
 */
export function botStepDelayMs(
  phase: Phase,
  revealedCount: number,
  botMoveDelayMs: number,
): number {
  if (botMoveDelayMs <= 0) return botMoveDelayMs;
  if (phase !== 'TUNNEL_PENDING') return botMoveDelayMs;
  const revealMs =
    Math.max(0, revealedCount - 1) * TUNNEL_REVEAL_STAGGER_MS +
    TUNNEL_REVEAL_FLIP_MS +
    TUNNEL_REVEAL_RESULT_PAD_MS;
  return Math.max(botMoveDelayMs, revealMs + TUNNEL_RESULT_READ_MS);
}
