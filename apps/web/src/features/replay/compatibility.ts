import { SCHEMA_VERSION } from '@trm/engine';

/** Engine 9 action logs remain deterministic under engine 10; schema compatibility stays exact. */
export const REPLAY_COMPATIBLE_ENGINE_VERSIONS: readonly number[] = [9, 10];

export function isReplayVersionCompatible(engineVersion: number, schemaVersion: number): boolean {
  return (
    REPLAY_COMPATIBLE_ENGINE_VERSIONS.includes(engineVersion) && schemaVersion === SCHEMA_VERSION
  );
}
