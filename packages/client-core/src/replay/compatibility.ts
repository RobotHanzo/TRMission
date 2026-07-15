// Shared replay-version gate for both apps: the client must explicitly support the stored
// engine + schema before running an action log through its own reducer — the server's
// `replayable` flag is advisory, this is the authoritative check.
import { REPLAY_COMPATIBLE_ENGINE_VERSIONS, SCHEMA_VERSION } from '@trm/engine';

export { REPLAY_COMPATIBLE_ENGINE_VERSIONS };

export function isReplayVersionCompatible(engineVersion: number, schemaVersion: number): boolean {
  return (
    REPLAY_COMPATIBLE_ENGINE_VERSIONS.includes(engineVersion) && schemaVersion === SCHEMA_VERSION
  );
}
