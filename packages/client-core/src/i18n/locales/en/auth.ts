import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/auth';

export default {
  tagline: 'Claim railway routes across Taiwan and complete your mission tickets.',
  guestName: 'Display name',
  playAsGuest: 'Play as guest',
  guestNotice: "You're playing as a guest — create an account to keep your match history.",
  upgradeBlurb: 'Set an email and password for your guest account to keep your match history.',
  createAccount: 'Create an account',
  email: 'Email',
  signIn: 'Sign in',
  signOut: 'Sign out',
} satisfies TranslationShape<typeof zh>;
