import * as SecureStore from 'expo-secure-store';

// The refresh token is the mobile analogue of the web's httpOnly cookie: it lives in the OS
// keystore (iOS Keychain / Android Keystore), never in JS-readable storage. Key chars must be
// alphanumeric plus '.', '-', '_'.
const REFRESH_KEY = 'trm.refresh';

/**
 * iOS launches us in the background — push delivery, prewarming, an OTA check — and the device may
 * still be locked when it does. expo-secure-store's default accessibility is `WHEN_UNLOCKED`, so
 * every read during such a launch fails with `errSecInteractionNotAllowed` ("User interaction is
 * not allowed", TRMISSION-MOBILE-3). `AFTER_FIRST_UNLOCK` keeps the item readable while the screen
 * is locked, as long as the device has been unlocked once since boot — the standard accessibility
 * for a credential the app must use without a person present. It applies at WRITE time, so
 * installs already holding a token migrate on their next rotation, not immediately; that is why
 * `readRefreshToken` below still has to handle a refusal.
 */
const WRITE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * The distinction the callers need: `'unavailable'` is the OS refusing the read (device locked
 * before its first unlock since boot, or a pre-migration item), which is NOT the same as `null`
 * — "there is no token". Treating one as the other either signs a signed-in player out or wedges
 * the boot gate, so this never throws and never collapses the two.
 */
export type RefreshTokenRead = string | null | 'unavailable';

export const readRefreshToken = async (): Promise<RefreshTokenRead> => {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return 'unavailable';
  }
};

/** Transport-side read: an unreadable keystore and an empty one both mean "nothing to rotate". */
export const getRefreshToken = async (): Promise<string | null> => {
  const read = await readRefreshToken();
  return read === 'unavailable' ? null : read;
};

export const setRefreshToken = (token: string): Promise<void> =>
  SecureStore.setItemAsync(REFRESH_KEY, token, WRITE_OPTS);

export const clearRefreshToken = (): Promise<void> => SecureStore.deleteItemAsync(REFRESH_KEY);
