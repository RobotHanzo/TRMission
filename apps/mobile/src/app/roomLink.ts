import { SERVER_ORIGIN } from '../config';

/**
 * Cold-start room links can't ride React Navigation's `linking` config alone: the launch URL
 * is resolved ONCE at container mount, when the auth-gated stack (navigation.tsx) contains
 * only Boot — the resolved Room route is dropped on reconcile and never re-applied when
 * boot/login swaps the real stack in. So App.tsx stashes any /room link here and
 * RootNavigator applies it as soon as the signed-in stack (which owns the Room screen) is on
 * screen — which also makes a link tapped while signed OUT resume into its room right after
 * login/guest entry.
 */

/** `trmission://room/CODE`, `trmission:///room/CODE`, or `${SERVER_ORIGIN}/room/CODE` → CODE. */
export function parseRoomLink(url: string): string | null {
  // The custom scheme arrives with or without an empty authority (trmission:///room/…).
  const scheme = /^trmission:\/\/\/?room\/([^/?#]+)/.exec(url);
  if (scheme) return decodeURIComponent(scheme[1]);
  // Universal/App Links only ever carry our own origin; mirror `linking.prefixes` and refuse
  // foreign hosts rather than trusting whatever the OS hands over.
  if (url.startsWith(`${SERVER_ORIGIN}/`)) {
    const web = /^[^:]+:\/\/[^/]+\/room\/([^/?#]+)/.exec(url);
    if (web) return decodeURIComponent(web[1]);
  }
  return null;
}

let pendingRoomCode: string | null = null;

/** Remember a room link for later; a non-room URL (e.g. the OAuth /m/callback) is a no-op. */
export function stashRoomLink(url: string): void {
  const code = parseRoomLink(url);
  if (code) pendingRoomCode = code;
}

/** Hand over the stashed room code (once); null when nothing is pending. */
export function consumePendingRoomLink(): string | null {
  const code = pendingRoomCode;
  pendingRoomCode = null;
  return code;
}
