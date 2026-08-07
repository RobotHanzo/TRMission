import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/support';

export default {
  title: 'Help & support',
  lede: 'Something broken, a bug to report, or an idea to share? Check the common questions below first — if the answer isn’t there, use the form or one of the other channels.',
  responseTime:
    'TRMission is a personal hobby project. We answer as soon as we can, which is usually a few days.',

  faq: {
    title: 'Common questions',
    signinQ: 'I can’t sign in, or my account is gone',
    signinA:
      'Check that you’re using the sign-in method you registered with (email, Google, Discord, or Apple). Signing in with the same verified email address always lands on the same account. If it still fails, send us your email address and display name below.',
    guestQ: 'How long does a guest account last?',
    guestA:
      'A guest account is tied to this device’s session and auto-deletes after about 30 days of inactivity, taking its match history with it. Upgrade to a full account in Settings to keep your record.',
    deleteQ: 'I want to delete my account and data',
    deleteA:
      'You can do this yourself without contacting us: use the Delete account page on the web, or Settings ▸ Account in the mobile app. Finished match records are kept in anonymised form, because they are also other players’ results.',
    bugQ: 'A game is stuck or something went wrong',
    bugA: 'Reload or reconnect first — the server holds the full match record, so reconnecting puts you back exactly where you were. If it persists, tell us the room code, the game id, and what you were doing.',
    reportQ: 'I want to report a player or a custom map',
    reportA:
      'Report it in the app instead: use the report button on a player’s avatar or next to a chat message, or on a shared map’s page. That goes straight into the moderation queue and is faster than email. You can also block the player in-game.',
    rulesQ: 'I don’t know how to play',
    rulesA:
      'The interactive tutorial takes about 5 minutes and needs no account, and the rules encyclopedia is available any time during a game.',
  },

  links: {
    title: 'Related pages',
    tutorial: 'Interactive tutorial',
    deleteAccount: 'Delete account',
    privacy: 'Privacy policy',
    terms: 'Terms of service',
  },

  channels: {
    title: 'Ways to reach us',
    discordTitle: 'Discord community',
    discordBody:
      'The fastest channel: ask a question, report a problem, or reach a maintainer directly.',
    discordCta: 'Join the Discord',
    emailTitle: 'Email',
    emailBody: 'If you’d rather not use the form, write to us at:',
  },

  form: {
    title: 'Send us a message',
    intro:
      'No account needed. If you are signed in we’ll see your account alongside the message, which makes problems much easier to trace.',
    signedInAs: 'Sending as {{name}}',
    unavailable:
      'The online form is not enabled on this deployment — please use the email address or Discord above instead.',
    category: 'What is this about?',
    subject: 'Subject',
    subjectPlaceholder: 'One line describing the problem',
    message: 'Details',
    messagePlaceholder:
      'What happened? If it concerns a specific match, include the room code or game id.',
    email: 'Email for our reply',
    emailPlaceholder: 'you@example.com',
    emailHint: 'Optional — but without an address we have no way to answer you.',
    name: 'Your name',
    namePlaceholder: 'Optional',
    submit: 'Send',
    sending: 'Sending…',
    sentTitle: 'Sent — thank you!',
    sentBody:
      'Your message reached the maintainers. If you left an email address we’ll reply to it directly.',
    sendAnother: 'Send another',
    errorGeneric:
      'We couldn’t send that. Please try again shortly, or reach us by email or on Discord.',
    errorRateLimited: 'That’s a lot of messages in a short time — please try again later.',
    errorUnavailable:
      'The online form is unavailable right now. Please use the email address or Discord instead.',
  },

  category_BUG: 'A bug or something broken',
  category_ACCOUNT: 'Account & sign-in',
  category_GAMEPLAY: 'Rules & matches',
  category_FEEDBACK: 'Feedback & suggestions',
  category_OTHER: 'Something else',
} satisfies TranslationShape<typeof zh>;
