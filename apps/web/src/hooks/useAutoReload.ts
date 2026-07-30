import { useEffect, useState } from 'react';
import { useGame } from '@trm/client-core/store/game';
import { currentBuildId, useBuildVersion } from '../store/buildVersion';

/**
 * Silently move a loaded tab onto a newly deployed bundle — no "a new version is available, reload?"
 * prompt (docs/release/server-ota.md).
 *
 * Two decisions worth knowing:
 *
 * **What we compare against.** `/build.json` is served by the WEB TIER, so it always describes the
 * bundle nginx would hand out right now. Comparing against the server's `/version` commitHash
 * instead would be a reload LOOP: the two containers update independently, so there are seconds
 * where the server reports a new commit while nginx still serves the old bundle, and every client
 * would reload straight back into the build it was trying to leave.
 *
 * **When we look.** A deploy — OTA or image pull — always restarts the server, which drops every
 * socket. So the socket dropping IS the notification, and no new protobuf frame was needed for this:
 * an in-game tab notices within a second of the restart. Tab focus and a slow interval cover
 * everyone else (lobby, home, a tab that missed the drop).
 */

/** Floor for tabs that are neither focused-changing nor socket-connected. */
const POLL_MS = 60_000;
/** Where the reload marker lives: per-tab, and gone when the tab is. */
const RELOAD_MARKER_KEY = 'trm.buildReload';
/**
 * A tab may auto-reload to a given build id once per this window. If it comes back still running the
 * old bundle — a CDN serving a stale index.html, a bad build.json — reloading again would spin
 * forever, so we stop and let the page carry on working instead.
 */
const RELOAD_COOLDOWN_MS = 5 * 60_000;

function alreadyTried(served: string): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_MARKER_KEY);
    if (raw === null) return false;
    const marker = JSON.parse(raw) as { to?: string; at?: number };
    return marker.to === served && Date.now() - (marker.at ?? 0) < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markTried(served: string): void {
  try {
    sessionStorage.setItem(RELOAD_MARKER_KEY, JSON.stringify({ to: served, at: Date.now() }));
  } catch {
    /* storage disabled — the cooldown can't be enforced; the reload below still happens once */
  }
}

async function probe(): Promise<string | null> {
  try {
    // no-store on both the request and (via nginx) the response: Cloudflare sits in front of this
    // deployment and one cached build.json would pin every client to a build that no longer exists.
    const response = await fetch('/build.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as { buildId?: unknown };
    return typeof body.buildId === 'string' ? body.buildId : null;
  } catch {
    return null; // offline, or a deploy mid-flight — the next trigger tries again
  }
}

/** Mounted once at the app root. Never renders anything. */
export function useAutoReload(): void {
  const socketStatus = useGame((s) => s.status);
  const outdated = useBuildVersion((s) => s.outdated);
  const served = useBuildVersion((s) => s.served);
  const holds = useBuildVersion((s) => s.holds);
  const observeServed = useBuildVersion((s) => s.observeServed);

  // A local build compares 'dev' to 'dev' forever, so skip the whole thing rather than poll a
  // file that only exists to answer a question this build can't ask.
  const armed = currentBuildId() !== 'dev';
  // Tracked in state, not read ad hoc: a tab that goes stale while hidden must reload when it comes
  // BACK, and the probe alone can't wake that up — re-reporting the same build id is not a state
  // change, so the reload effect below would never re-run.
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  useEffect(() => {
    if (!armed) return;
    let cancelled = false;
    const check = (): void => {
      void probe().then((id) => {
        if (!cancelled && id !== null) observeServed(id);
      });
    };

    check();
    const interval = setInterval(check, POLL_MS);
    const onVisibilityChange = (): void => {
      const nowVisible = document.visibilityState === 'visible';
      setVisible(nowVisible);
      if (nowVisible) check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [armed, observeServed]);

  // The socket dropping is the deploy signal: check immediately rather than waiting for the poll.
  useEffect(() => {
    if (!armed || (socketStatus !== 'reconnecting' && socketStatus !== 'closed')) return;
    void probe().then((id) => {
      if (id !== null) observeServed(id);
    });
  }, [armed, socketStatus, observeServed]);

  useEffect(() => {
    if (!outdated || served === null) return;
    if (holds > 0) return; // mid-selection: apply once it resolves
    if (!visible) return; // hidden tab: apply on the next focus
    if (alreadyTried(served)) return;
    markTried(served);
    window.location.reload();
  }, [outdated, served, holds, visible]);
}

/**
 * Hold off the auto-reload while `active` — for the moments where the user has entered something the
 * server has not seen yet (assembling a payment, resolving a tunnel). Game state is never at risk;
 * unsent input is.
 */
export function useReloadHold(active: boolean): void {
  const addHold = useBuildVersion((s) => s.addHold);
  const releaseHold = useBuildVersion((s) => s.releaseHold);
  useEffect(() => {
    if (!active) return;
    addHold();
    return releaseHold;
  }, [active, addHold, releaseHold]);
}
