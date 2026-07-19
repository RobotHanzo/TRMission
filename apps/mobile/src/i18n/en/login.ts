import { auth } from '@trm/client-core/i18n/locales/en';
import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/login';

export default {
  tagline: auth.tagline,
  guest: auth.playAsGuest,
  email: auth.email,
  password: 'Password',
  displayName: 'Display name',
  signIn: auth.signIn,
  register: 'Register',
  toRegister: 'No account? Register',
  toLogin: 'Have an account? Sign in',
  google: 'Continue with Google',
  discord: 'Continue with Discord',
  apple: 'Continue with Apple',
  or: 'or',
  guestName: auth.guestName,
  guestNotice: auth.guestNotice,
  upgradeBlurb: auth.upgradeBlurb,
  createAccount: auth.createAccount,
} satisfies TranslationShape<typeof zh>;
