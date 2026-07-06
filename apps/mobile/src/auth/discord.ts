import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE } from '../config';
import { api } from '../net/rest';
import { useSession } from '../store/session';

// The custom-scheme return the system browser redirects to. P0 accepts both this and the
// /m/callback universal link; ASWebAuthenticationSession/Custom Tabs close on either.
const RETURN_URL = 'trmission://';

const firstParam = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Discord has no native SDK, so we run the server's web OAuth dance in a system browser and hand a
 * one-time exchange code back through the deep link:
 *   [carry] a signed-in guest mints a single-use code so the callback can upgrade them in place →
 *   open `${API_BASE}/auth/oauth/discord/start?client=mobile&carry=<code>` →
 *   the browser returns `trmission://…?code=<c>` (or `…/m/callback?code=<c>`) →
 *   redeem the code for a token pair (which sets the session).
 */
export async function signInWithDiscord(): Promise<void> {
  const carry = useSession.getState().user ? (await api.mobileCarry()).code : undefined;
  let startUrl = `${API_BASE}/auth/oauth/discord/start?client=mobile`;
  if (carry) startUrl += `&carry=${encodeURIComponent(carry)}`;

  const result = await WebBrowser.openAuthSessionAsync(startUrl, RETURN_URL);
  if (result.type !== 'success') return; // user dismissed / cancelled

  const { queryParams } = Linking.parse(result.url);
  const error = firstParam(queryParams?.error);
  if (error) throw new Error(`discord sign-in failed: ${error}`);
  const code = firstParam(queryParams?.code);
  if (!code) throw new Error('discord sign-in did not return a code');

  await useSession.getState().loginWithDiscordExchange(code);
}
