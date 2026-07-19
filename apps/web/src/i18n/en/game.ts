import type { TranslationShape } from '@trm/client-core/i18n/shape';
import type zh from '../zh-Hant/game';

export default {
  connected: 'Connected',
  phase: 'Phase',
  pass: 'Pass',
  turnTimeoutHint: 'On time-out the server auto-draws a train card',
  sessionReplacedBody:
    'Your seat was reconnected from another tab or device, so this tab was disconnected.',

  endVoteTitle: 'End game early',
  endVoteTally: 'End votes: {{count}} / {{required}}',
  endVoteHint: '{{required}} votes will end the game immediately and show final scores.',
  endVoteHostHint: 'As room owner, you can end the game and score it immediately.',
  voteToEndGame: 'Vote to end game',
  withdrawEndVote: 'Withdraw end vote',
  endGameNow: 'End game now',
  endVoteConfirmTitle: 'End the game early?',
  endVoteConfirmBody:
    'Once {{required}} votes are reached, the game ends immediately and final scores open.',
  endVoteHostConfirmBody:
    'You are the room owner. Confirming ends the game immediately and opens final scores.',
  endVoteConfirm: 'Confirm vote',
  endVoteUpdating: 'Updating…',
  endVoteError: 'Could not update your end-game vote. Please try again.',
} satisfies TranslationShape<typeof zh>;
