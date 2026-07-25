# Tutorial (`apps/mobile/src/features/tutorial/` — P4)

App-wide context: `apps/mobile/CLAUDE.md`.

The interactive tutorial is fully offline: lessons are scripted scenarios over a REAL local
`@trm/engine` game (the shared `SandboxSocket` → engine `reduce` → `redactFor` → `viewToSnapshot`
→ the standard game store → GameStage). The tutorial core (`types`/`curriculum`/`focus`/
`useScenarioPlayer` + `i18n/tutorial`) lives in **`@trm/client-core`** (single source, shared with
web; the old byte-copy parity contract is retired) — the anchor-id strings inside it are
simultaneously the web's CSS selectors and this app's `TutorialTargetRegistry` anchor ids
(`targets.tsx`).

HUD spotlights measure ref-registered Views via `measureInWindow` (`useTutorialAnchor`, keep
`collapsable={false}`); city/route spotlights are computed from board geometry projected
through the camera (`boardRects.ts`; `cameraBridge.ts` is the only file that may touch camera
internals). The scrim is a Skia even-odd path (`scrim.ts` + `TutorialSpotlight`). Completion
persists to AsyncStorage (`progress.ts`, key `trm.tutorial.completed.v1`); the Home entry and
the whole flow work with no account and no network. Pure logic tests are vitest `*.spec.ts`;
RN components are jest-expo `*.test.tsx` — keep the globs disjoint.
