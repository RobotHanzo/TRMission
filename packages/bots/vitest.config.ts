import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every spec here drives one or more FULL games to completion (the 10-seed HELL-vs-HARD
    // no-regression gate drives ten), so they run in seconds, not milliseconds — well past
    // vitest's 5s default.
    //
    // They were always this slow; vitest 2 just never enforced the timeout on them. These bodies
    // are synchronous, so they block the event loop end to end and the timeout timer could never
    // fire mid-test. vitest 4 compares elapsed time once the body returns, so the same tests now
    // report honestly. Raising the limit is the fix — the specs themselves are unchanged and pass.
    testTimeout: 120_000,
  },
});
