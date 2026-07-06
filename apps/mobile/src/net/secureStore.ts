import * as SecureStore from 'expo-secure-store';

// The refresh token is the mobile analogue of the web's httpOnly cookie: it lives in the OS
// keystore (iOS Keychain / Android Keystore), never in JS-readable storage. Key chars must be
// alphanumeric plus '.', '-', '_'.
const REFRESH_KEY = 'trm.refresh';

export const getRefreshToken = (): Promise<string | null> =>
  SecureStore.getItemAsync(REFRESH_KEY);

export const setRefreshToken = (token: string): Promise<void> =>
  SecureStore.setItemAsync(REFRESH_KEY, token);

export const clearRefreshToken = (): Promise<void> =>
  SecureStore.deleteItemAsync(REFRESH_KEY);
