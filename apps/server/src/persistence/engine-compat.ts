/**
 * Which persisted engine majors the CURRENT engine can still run — the single gate for both
 * post-game replay and live crash recovery.
 *
 * A persisted `GameState` is the engine's own in-memory shape, stored verbatim. Loading one that a
 * PREVIOUS engine major wrote is not merely a digest risk, it is a *shape* risk: v8 added the
 * expansion fields (`luckyContracts`, `repairedRouteIds`, `resources`) to `EventsState`, so a v5–v7
 * snapshot rehydrated into v9 hands the reducer an `events` blob missing keys it dereferences
 * unconditionally. That is exactly how a stale snapshot used to take the process down. Refuse the
 * game instead: an old major is unresumable regardless (its stored digests were computed under
 * different rules and could never re-verify).
 *
 * The allowlist itself (`REPLAY_COMPATIBLE_ENGINE_VERSIONS`, with the version-by-version reasoning
 * for why each major was or wasn't provably inert for the ones before it) is owned by `@trm/engine`
 * — the only package every consumer (server recovery/replay, web replay, mobile replay) can import,
 * so the list can't drift between them. Re-exported here for existing call sites in this package.
 */
import { REPLAY_COMPATIBLE_ENGINE_VERSIONS } from '@trm/engine';
export { REPLAY_COMPATIBLE_ENGINE_VERSIONS } from '@trm/engine';

/**
 * Can the current engine load a game persisted under `version`? `undefined` = a legacy doc written
 * before the stamp existed, which by definition predates the current major.
 */
export function isEngineVersionSupported(version: number | undefined): boolean {
  return version !== undefined && REPLAY_COMPATIBLE_ENGINE_VERSIONS.includes(version);
}
