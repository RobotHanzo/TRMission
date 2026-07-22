import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/chat';

export default {
  heading: 'Chat',
  empty: 'No messages yet',
  placeholder: 'Type a message…',
  send: 'Send',
  rateLimited: 'Slow down a moment…',
  tooLong: 'Message too long (max 2048).',
  invalidPreset: 'Unrecognized preset message',
  spectatorTag: '[Spectator]',
  channelAll: 'All',
  channelTeam: 'Team',
  teamTag: '[Team]',
  teamPlaceholder: 'Message your team…',
  teamOnlyNote: 'Team messages reach only your teammates and are not kept in the log.',
  presets: {
    GREETING: 'Hello!',
    GOOD_LUCK: 'Good luck, have fun!',
    THANKS: 'Thanks!',
    SORRY: 'Sorry!',
    ONE_MOMENT: 'One moment please',
    NICE_MOVE: 'Nice move!',
    WELL_PLAYED: 'Well played!',
    GOOD_GAME: 'Good game!',
    LETS_GO: "Let's go!",
    STILL_THERE: 'Are you still there?',
    YES: 'Yes',
    NO: 'No',
  },
} satisfies TranslationShape<typeof zh>;
