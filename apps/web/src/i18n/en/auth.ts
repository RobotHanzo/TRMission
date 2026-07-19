import { auth } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/auth';

export default {
  welcome: 'Welcome, {{name}}',
  signUp: 'Sign up',
  password: 'Password (min 8 chars)',
  logout: auth.signOut,
  orContinueWith: 'Or continue with',
  continueWithGoogle: 'Continue with Google',
  continueWithDiscord: 'Continue with Discord',
  continueWithApple: 'Continue with Apple',
  authUnavailable: 'No sign-in methods are available right now.',
  oauthError: 'Sign-in failed. Please try again.',
  signingIn: 'Signing you in…',
  backToLogin: 'Back to sign in',
} satisfies TranslationShape<typeof zh>;
