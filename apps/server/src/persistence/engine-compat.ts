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
 * Engine majors whose persisted action logs the current server can still replay byte-identically.
 * v5 replayed a v4 log identically (v5 only added inert genesis fields), but v6 is NOT provably
 * inert for v4/v5 games (see history in git blame), and v7 is not provably inert for v6 either: v7
 * locks own-track ticket completions into `completedTickets` (and emits TICKET_COMPLETED) mid-game
 * for every ruleset, not just unlimitedStationBorrow, which changes `stateDigest` at exactly the
 * points a ticket completes — a v6 game replayed under v7 would digest-mismatch at that step. So v7
 * stands alone rather than extending the allowlist. Only extend this list for a new version when
 * the change is provably inert for the versions already listed. v8 adds stateful future-event
 * actions/phases and therefore cannot replay a v7 action log byte-identically. v9 changes the
 * deadlock rule: a dead-pool `DRAW_TICKETS` with no productive move is now rejected (and the
 * endgame can trigger on a deadlock), so a v8 log containing such an action would diverge or become
 * illegal under v9. v10 only adds the terminal `END_GAME` action; every existing v9 action retains
 * identical behavior, so the current interpreter supports persisted v9 and v10 games.
 */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [9, 10];

/**
 * Can the current engine load a game persisted under `version`? `undefined` = a legacy doc written
 * before the stamp existed, which by definition predates the current major.
 */
export function isEngineVersionSupported(version: number | undefined): boolean {
  return version !== undefined && REPLAY_COMPATIBLE_ENGINE_VERSIONS.includes(version);
}
