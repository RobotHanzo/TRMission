// Opt-in strength benchmark (not a CI gate): TRM_BOT_HARNESS=1 yarn workspace @trm/bots test --run strength
// Plays a pool of seeded head-to-head matches between two difficulties (seats alternate so
// first-player advantage cancels) and prints wins/losses/mean margin. Use it when tuning a
// policy so a change is measured across many seeds — single seeds swing by ±70 points, so this
// pool (default 20 games; TRM_BOT_HARNESS_GAMES=100 for tuning decisions) is the discriminating
// instrument, not the 10-seed no-regression gate in policy.spec.ts. Deterministic: same seeds →
// same table.
import { describe, it, expect } from 'vitest';
import type { BotDifficulty } from '../src';
import { A, B, driveGame, totalScore } from './helpers';

/** Head-to-head over `n` seeds with alternating seats; returns challenger's record. */
function headToHead(
  challenger: BotDifficulty,
  incumbent: BotDifficulty,
  n: number,
): { wins: number; losses: number; ties: number; totalMargin: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let totalMargin = 0;
  for (let i = 0; i < n; i++) {
    const seed = `strength-harness-${challenger}-${incumbent}-${i}`;
    const challengerFirst = i % 2 === 0;
    const state = driveGame(
      seed,
      challengerFirst ? challenger : incumbent,
      challengerFirst ? incumbent : challenger,
    );
    const c = totalScore(state, (challengerFirst ? A : B) as string);
    const inc = totalScore(state, (challengerFirst ? B : A) as string);
    if (c > inc) wins++;
    else if (c < inc) losses++;
    else ties++;
    totalMargin += c - inc;
  }
  return { wins, losses, ties, totalMargin };
}

describe.runIf(!!process.env.TRM_BOT_HARNESS)('bot strength harness (opt-in)', () => {
  const n = Number(process.env.TRM_BOT_HARNESS_GAMES ?? 20);

  it(`HELL vs HARD over ${n} seeds`, () => {
    const r = headToHead('HELL', 'HARD', n);
    console.log(
      `HELL vs HARD: ${r.wins}W-${r.losses}L-${r.ties}T, mean margin ${(r.totalMargin / n).toFixed(1)}`,
    );
    expect(r.wins + r.losses + r.ties).toBe(n);
  });

  it(`HARD vs MEDIUM over ${n} seeds`, () => {
    const r = headToHead('HARD', 'MEDIUM', n);
    console.log(
      `HARD vs MEDIUM: ${r.wins}W-${r.losses}L-${r.ties}T, mean margin ${(r.totalMargin / n).toFixed(1)}`,
    );
    expect(r.wins + r.losses + r.ties).toBe(n);
  });
});
