import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { api } from '../net/rest';
import { unregisterDeviceForPush } from '../push/register';
import { useSession } from '../store/session';

export type DeletionOutcome = 'deleted' | 'cancelled' | 'failed';

/**
 * Account deletion, store-compliant:
 *  1. Apple-linked accounts re-auth via SIWA for a FRESH authorizationCode so the server
 *     can revoke Apple tokens (TN3194). Cancellation of the re-auth does NOT block deletion —
 *     revocation is best-effort by design (the server treats the code as optional).
 *  2. The device push token is deregistered while the Bearer still works.
 *  3. DELETE /auth/me cascades server-side; only then is the local session cleared.
 * Maintainers get a 409 until dashboard access is revoked — surfaced as 'failed'.
 */
export async function performAccountDeletion(): Promise<DeletionOutcome> {
  let appleAuthorizationCode: string | undefined;
  const method = useSession.getState().signInMethod;
  if (
    method === 'apple' &&
    Platform.OS === 'ios' &&
    (await AppleAuthentication.isAvailableAsync())
  ) {
    try {
      const cred = await AppleAuthentication.signInAsync();
      appleAuthorizationCode = cred.authorizationCode ?? undefined;
    } catch {
      // User cancelled the re-auth sheet: proceed without the code.
    }
  }
  try {
    await unregisterDeviceForPush();
    await api.deleteAccount(appleAuthorizationCode);
  } catch {
    return 'failed';
  }
  await useSession.getState().clearLocalSession();
  return 'deleted';
}
