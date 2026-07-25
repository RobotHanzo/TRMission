// The MANUAL half of OTA updates (mechanism + runbook: docs/mobile/ota.md). expo-updates already
// checks on every cold start — `fallbackToCacheTimeout: 0`, so launch never waits and a downloaded
// bundle applies on the NEXT start. This is the impatient path behind Settings ▸ About: check now,
// download now, restart into it now.
//
// Deliberately NOT the forced-update gate in version.ts. That one compares the NATIVE build number
// against the server's `minBuild`, and no OTA update can ever satisfy it (an update replaces JS,
// never the binary). The two never talk to each other.
import * as Updates from 'expo-updates';

export type OtaOutcome =
  /** A new bundle (or a roll back to the embedded one) is downloaded and waiting for a restart. */
  | 'ready'
  /** The server has nothing newer for this binary's runtimeVersion. */
  | 'upToDate'
  /** OTA is compiled out here — dev client, Expo Go, the RNW harness, or `updates.enabled: false`. */
  | 'unsupported'
  /** Offline, a wedged OTA host, a bad manifest signature. Nothing is broken; try again later. */
  | 'failed';

/**
 * Whether this build has OTA wired up at all. False when the updates config didn't resolve (no URL,
 * no runtime version, storage error) — see `Updates.isEnabled`. A dev client reports `true` here and
 * only rejects at call time, which `fetchOtaUpdate` maps to `'unsupported'`.
 */
export const OTA_SUPPORTED: boolean = Updates.isEnabled;

/**
 * Check and, if there is something to get, download it in one step: an update the user cannot apply
 * yet is not worth reporting. Never throws — every failure mode is an outcome.
 */
export async function fetchOtaUpdate(): Promise<OtaOutcome> {
  if (!OTA_SUPPORTED) return 'unsupported';
  try {
    const check = await Updates.checkForUpdateAsync();
    // A roll back to the embedded bundle arrives as its own result shape (`isAvailable: false`) and
    // still needs the fetch + restart, so it is an update as far as this row is concerned.
    if (!check.isAvailable && !check.isRollBackToEmbedded) return 'upToDate';
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew || fetched.isRollBackToEmbedded ? 'ready' : 'upToDate';
  } catch (err) {
    // A dev client, Expo Go and the web harness reject EVERY Updates call with this code. That is
    // "not applicable here", not a failure — don't tell a developer their update server is down.
    return (err as { code?: string }).code === 'ERR_UPDATES_DISABLED' ? 'unsupported' : 'failed';
  }
}

/**
 * Restart into the downloaded bundle. The promise resolves right BEFORE the reload is posted to the
 * main thread, so nothing may be sequenced after it — treat the call as the end of the program.
 */
export async function applyOtaUpdate(): Promise<void> {
  await Updates.reloadAsync();
}
