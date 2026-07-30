// The server-OTA poll loop and its decision table (docs/release/server-ota.md).
//
// One check, three possible answers:
//
//   commit == running                  → up_to_date, nothing to do
//   depsFingerprint != this image's    → needs_image_pull; CI sees this in /status and fires the
//                                        Portainer stack webhook instead. NEVER hot-applied: the
//                                        bundle carries no node_modules, so it cannot satisfy it.
//   otherwise                          → apply + restart
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import { env } from '../config/env';
import { MetricsService } from '../observability/metrics.service';
import { applyBundle, inspectWebTier, type WebTier } from './applier';
import { currentCommit } from './buildInfo';
import {
  clearJournal,
  imageFingerprint,
  otaPaths,
  readJournal,
  readState,
  writeState,
  type OtaPaths,
} from './layout';
import { ManifestRejected, fetchManifest, parsePublicKey, type OtaManifest } from './manifest';

export type SelfUpdateResult = 'up_to_date' | 'applied' | 'needs_image_pull' | 'rejected' | 'error';

export interface SelfUpdateStatus {
  /** False ⇒ nothing below is acted on; the deployment only ever changes through an image pull. */
  enabled: boolean;
  /** Commit baked into the image (GIT_COMMIT). */
  imageCommit: string;
  /** What is actually running: the applied bundle if there is one, else the image. */
  runningCommit: string;
  appliedCommit: string | null;
  /** This image's fence. CI compares it against the manifest's to pick OTA vs image pull. */
  depsFingerprint: string;
  /** Whether web releases written here are served by the nginx container. */
  webOta: 'ready' | 'unavailable';
  pollMs: number;
  lastCheckedAt: string | null;
  lastResult: SelfUpdateResult | null;
  lastError: string | null;
  latest: {
    commit: string;
    builtAt: string;
    depsFingerprint: string;
    needsImagePull: boolean;
  } | null;
  /** Non-null while an applied bundle has yet to prove it can stay up. */
  pendingVerify: { commit: string; attempts: number } | null;
}

/** How long a freshly-applied bundle must stay up before the rollback marker is dropped. Long enough
 *  to cover Mongo connect, recovery of live games, and the first fan-out. */
const VERIFY_AFTER_MS = 60_000;
/** Delay before the first check so a boot is never slowed by a network round trip. */
const FIRST_CHECK_DELAY_MS = 5_000;
/** A check that hangs must not pin the loop forever. */
const CHECK_TIMEOUT_MS = 60_000;

@Injectable()
export class SelfUpdateService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(SelfUpdateService.name);
  private readonly paths: OtaPaths = otaPaths(env.selfUpdateAppRoot);
  private readonly fingerprint = imageFingerprint(this.paths);
  private readonly web: WebTier = inspectWebTier(env.selfUpdateWebRoot);
  private key: KeyObject | null = null;
  private timers: NodeJS.Timeout[] = [];
  private etag: string | null = null;
  private checking = false;
  /** Set once an apply has landed: the process is on its way out, so further checks are pointless. */
  private restarting = false;
  private lastCheckedAt: string | null = null;
  private lastResult: SelfUpdateResult | null = null;
  private lastError: string | null = null;
  private latest: SelfUpdateStatus['latest'] = null;
  private restarter: (() => Promise<void> | void) | null = null;

  constructor(private readonly metrics: MetricsService) {}

  /**
   * How the process gets replaced. Provided by main.ts rather than done here so the shutdown is a
   * real Nest `app.close()` — the command queue drains, Mongo closes, sockets are closed cleanly —
   * and the container's restart policy is what brings the new code up.
   */
  setRestarter(restarter: () => Promise<void> | void): void {
    this.restarter = restarter;
  }

  get enabled(): boolean {
    return (
      env.selfUpdateManifestUrl !== '' && env.selfUpdatePublicKey !== '' && this.fingerprint !== ''
    );
  }

  onApplicationBootstrap(): void {
    // Clear the rollback marker only once this build has proven it can run. Scheduled before the
    // `enabled` bail-out on purpose: a bundle that turned self-update OFF still has to be verifiable,
    // or it would be rolled back on its third boot for no reason.
    this.schedule(setTimeout(() => this.markVerified(), VERIFY_AFTER_MS));

    if (!this.enabled) {
      if (env.selfUpdateManifestUrl !== '' && this.fingerprint === '') {
        this.log.warn('self-update disabled: this image has no .trm-deps-fingerprint (rebuild it)');
      }
      return;
    }
    try {
      this.key = parsePublicKey(env.selfUpdatePublicKey);
    } catch (error) {
      this.log.error(`self-update disabled: ${(error as Error).message}`);
      return;
    }
    this.log.log(
      `self-update armed (${currentCommit()}, fence ${this.fingerprint.slice(0, 19)}…, web ${this.web.shared ? 'ready' : 'unavailable'})`,
    );
    this.schedule(setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS));
    if (env.selfUpdatePollMs > 0) {
      this.schedule(setInterval(() => void this.check(), env.selfUpdatePollMs));
    }
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private schedule(timer: NodeJS.Timeout): void {
    // unref so a test process (or a shutdown that races a pending timer) is never held open by the
    // poll loop.
    timer.unref();
    this.timers.push(timer);
  }

  status(): SelfUpdateStatus {
    const state = readState(this.paths);
    return {
      enabled: this.enabled,
      imageCommit: env.gitCommit,
      runningCommit: state.appliedCommit ?? env.gitCommit,
      appliedCommit: state.appliedCommit ?? null,
      depsFingerprint: this.fingerprint,
      webOta: this.web.shared ? 'ready' : 'unavailable',
      pollMs: env.selfUpdatePollMs,
      lastCheckedAt: this.lastCheckedAt,
      lastResult: this.lastResult,
      lastError: this.lastError,
      latest: this.latest,
      pendingVerify: state.pendingVerify ?? null,
    };
  }

  /** Fetch the manifest and act on it. Never throws — every failure is a recorded result. */
  async check(): Promise<SelfUpdateResult> {
    if (!this.enabled || this.key === null || this.checking || this.restarting) {
      return this.lastResult ?? 'up_to_date';
    }
    this.checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const fetched = await fetchManifest(
        env.selfUpdateManifestUrl,
        this.key,
        this.etag,
        controller.signal,
      );
      this.lastCheckedAt = new Date().toISOString();
      if (fetched === null) return this.record('up_to_date');
      this.etag = fetched.etag;
      return await this.actOn(fetched.manifest);
    } catch (error) {
      if (error instanceof ManifestRejected) {
        this.metrics.selfUpdateRejected(error.reason);
        this.log.error(`self-update rejected a manifest: ${error.reason}`);
        return this.record('rejected', error.reason);
      }
      this.log.warn(`self-update check failed: ${(error as Error).message}`);
      return this.record('error', (error as Error).message);
    } finally {
      clearTimeout(timeout);
      this.checking = false;
    }
  }

  private async actOn(manifest: OtaManifest): Promise<SelfUpdateResult> {
    const needsImagePull = manifest.depsFingerprint !== this.fingerprint;
    this.latest = {
      commit: manifest.commit,
      builtAt: manifest.builtAt,
      depsFingerprint: manifest.depsFingerprint,
      needsImagePull,
    };
    if (manifest.commit === currentCommit()) return this.record('up_to_date');
    if (needsImagePull) {
      this.log.warn(
        `${manifest.commit} changes dependencies — it needs an image pull, not an OTA. ` +
          'Redeploy the stack (CI fires the Portainer webhook for exactly this case).',
      );
      return this.record('needs_image_pull');
    }

    this.log.log(`applying ${manifest.commit}…`);
    try {
      await applyBundle({
        manifest,
        runningCommit: currentCommit(),
        web: this.web,
        paths: this.paths,
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        log: (message) => this.log.log(message),
      });
    } catch (error) {
      if (error instanceof ManifestRejected) {
        this.metrics.selfUpdateRejected(error.reason);
        this.log.error(`self-update rejected ${manifest.commit}: ${error.reason}`);
        return this.record('rejected', error.reason);
      }
      this.log.error(`self-update failed to apply ${manifest.commit}: ${(error as Error).message}`);
      return this.record('error', (error as Error).message);
    }
    this.restarting = true;
    this.record('applied');
    this.log.warn(`${manifest.commit} applied — restarting into it now`);
    // Deliberately not awaited: this call closes the app that is executing it.
    void Promise.resolve(this.restarter?.()).catch((error: unknown) => {
      this.log.error(`restart after self-update failed: ${(error as Error).message}`);
    });
    return 'applied';
  }

  private record(result: SelfUpdateResult, error?: string): SelfUpdateResult {
    this.lastResult = result;
    this.lastError = error ?? null;
    this.metrics.selfUpdateChecked(result);
    return result;
  }

  /**
   * This build has been up long enough to be considered good: drop the journal and the rollback
   * marker so the next boot doesn't count against it. Until this runs, two more boots would put the
   * previous code back (selfupdate/recover.ts).
   */
  private markVerified(): void {
    const state = readState(this.paths);
    if (state.pendingVerify === undefined && readJournal(this.paths) === null) return;
    const { pendingVerify: verified, ...rest } = state;
    writeState(rest, this.paths);
    clearJournal(this.paths);
    if (verified !== undefined)
      this.log.log(`${verified.commit} verified — rollback marker cleared`);
  }
}
