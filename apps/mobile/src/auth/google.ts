import { GoogleSigninModule } from './googleSigninModule';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config';
import { useSession } from '../store/session';

// `webClientId` is the audience the server validates the ID token against (accepted via the
// server's GOOGLE_MOBILE_CLIENT_IDS list); `iosClientId` selects the native iOS client.
let configured = false;
function ensureConfigured(): void {
  if (configured || !GoogleSigninModule) return;
  GoogleSigninModule.GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID || undefined,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    offlineAccess: false,
  });
  configured = true;
}

/** Native Google Sign-In → ID token → the server credential endpoint (mirrors web One Tap). */
export async function signInWithGoogle(): Promise<void> {
  if (!GoogleSigninModule) return; // Expo Go: needs a real dev/production build
  ensureConfigured();
  await GoogleSigninModule.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSigninModule.GoogleSignin.signIn();
  if (!GoogleSigninModule.isSuccessResponse(response)) return; // user cancelled
  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google sign-in returned no ID token');
  await useSession.getState().loginWithGoogleCredential(idToken);
}
