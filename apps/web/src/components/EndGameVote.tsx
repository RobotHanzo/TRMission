import { useState } from 'react';
import { Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RoomMember } from '../net/rest';
import { ConfirmDialog } from './ConfirmDialog';

interface EndGameVoteProps {
  members: RoomMember[];
  playerId: string;
  isHost: boolean;
  pending?: boolean | undefined;
  error?: boolean | undefined;
  onVote: (wantsEnd: boolean) => void;
}

/**
 * Advisory live-game vote UI. The room service remains authoritative: this only reports intent,
 * while the server decides whether the host voted or the (human player count - 1) threshold was
 * met and then broadcasts the GAME_OVER snapshot that opens the existing scoreboard.
 */
export function EndGameVote({
  members,
  playerId,
  isHost,
  pending,
  error,
  onVote,
}: EndGameVoteProps) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const humanMembers = members.filter((member) => !member.isBot);
  const required = Math.max(1, humanMembers.length - 1);
  const count = humanMembers.filter((member) => member.wantsEnd).length;
  const myVote = members.find((member) => member.userId === playerId)?.wantsEnd ?? false;
  const canWithdraw = myVote && !isHost;

  const toggle = () => {
    if (canWithdraw) {
      onVote(false);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <section className="end-vote" data-testid="end-game-vote" aria-labelledby="end-vote-title">
      <div className="end-vote-head">
        <h4 id="end-vote-title">
          <Flag size={14} aria-hidden /> {t('endVoteTitle')}
        </h4>
        <span className="end-vote-tally" aria-live="polite">
          {t('endVoteTally', { count, required })}
        </span>
      </div>
      <p className="end-vote-hint">{t(isHost ? 'endVoteHostHint' : 'endVoteHint', { required })}</p>
      {error && (
        <p className="error end-vote-error" role="alert">
          {t('endVoteError')}
        </p>
      )}
      <button
        type="button"
        className={canWithdraw ? '' : 'danger'}
        data-testid="end-game-vote-toggle"
        disabled={pending}
        onClick={toggle}
      >
        {pending
          ? t('endVoteUpdating')
          : t(canWithdraw ? 'withdrawEndVote' : isHost ? 'endGameNow' : 'voteToEndGame')}
      </button>

      {confirmOpen && (
        <ConfirmDialog
          title={t('endVoteConfirmTitle')}
          message={t(isHost ? 'endVoteHostConfirmBody' : 'endVoteConfirmBody', { required })}
          confirmLabel={t(isHost ? 'endGameNow' : 'endVoteConfirm')}
          onConfirm={() => {
            setConfirmOpen(false);
            onVote(true);
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </section>
  );
}
