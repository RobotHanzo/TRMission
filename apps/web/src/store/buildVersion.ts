import { create } from 'zustand';

/**
 * Whether the bundle this tab is running is still the one the web tier serves — the state behind
 * silent auto-reload after a deploy (docs/release/server-ota.md, `hooks/useAutoReload.ts`).
 *
 * Lives in `apps/web` rather than `@trm/client-core` deliberately: it has no mobile counterpart to
 * share with. The app reaches a device through expo-updates, which replaces the JS bundle and
 * restarts the app itself — there is no page to reload and no `/build.json` to compare against.
 */

/**
 * The commit this bundle was built from, baked in by Vite (`VITE_COMMIT_HASH`, from the image's
 * GIT_COMMIT build arg). 'dev' in a local build, which is why an unstamped build never reloads: the
 * probe would compare 'dev' to 'dev'.
 *
 * A function, not a module constant, so a test can stub the env without re-importing the module.
 */
export function currentBuildId(): string {
  // Empty counts as unstamped, not as a build id: Vite substitutes an unset env var as '', and an ''
  // treated as real would make every tab consider itself outdated against any served id.
  const stamped = import.meta.env.VITE_COMMIT_HASH ?? '';
  return stamped === '' ? 'dev' : stamped;
}

interface BuildVersionState {
  /** Build id the web tier reported last, or null before the first successful probe. */
  served: string | null;
  /** A newer bundle is being served. One-way: a flapping probe must not un-stale a tab. */
  outdated: boolean;
  /**
   * Active "not right now" holds. A reload is safe for game state at any moment — the server is
   * authoritative and reconnect restores the seat — but it throws away input the user has entered
   * and the server has not seen yet, which is what these guard.
   */
  holds: number;
  observeServed(served: string): void;
  addHold(): void;
  releaseHold(): void;
}

export const useBuildVersion = create<BuildVersionState>()((set) => ({
  served: null,
  outdated: false,
  holds: 0,
  observeServed: (served) =>
    set((s) => ({
      served,
      outdated: s.outdated || (served !== '' && served !== currentBuildId()),
    })),
  addHold: () => set((s) => ({ holds: s.holds + 1 })),
  releaseHold: () => set((s) => ({ holds: Math.max(0, s.holds - 1) })),
}));
