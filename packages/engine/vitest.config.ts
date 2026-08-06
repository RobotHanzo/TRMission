import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The golden-replay, termination and property suites each drive many FULL games to completion
    // (every seed × player-count × rule variant), so they run in seconds, not milliseconds.
    //
    // They were always this slow; vitest 2 just never enforced the timeout on them. These bodies
    // are synchronous, so they block the event loop end to end and the timeout timer could never
    // fire mid-test. vitest 4 compares elapsed time once the body returns, so the same tests now
    // report honestly. The digests themselves never changed — every assertion still passes.
    testTimeout: 120_000,
  },
});
