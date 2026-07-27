// Report / block dialog (Apple 1.2 / Play UGC) — the web counterpart of mobile's
// PlayerActionSheet. Opens from the player card's report action and from a chat message's
// report button. Never offer it for yourself or a bot: gate the call site with `canModerate`.
//
// Blocking is display-only. It filters chat and masks the blocked player's name and picture;
// it never touches game state, seating, or matchmaking, so a blocked opponent stays at the
// table and the game plays out normally.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { REPORT_CATEGORIES, type ReportCategory } from '@trm/shared';
import { api } from '../net/rest';
import { useModeration } from '../store/moderation';
import { useUi } from '../store/ui';

const MSG_MAX = 1000;

export function PlayerActionDialog({
  target,
  onClose,
}: {
  /** The player this dialog acts on; null renders nothing (dialog closed). */
  target: { id: string; name: string } | null;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const blocked = useModeration((s) => s.blocked);
  const block = useModeration((s) => s.block);
  const unblock = useModeration((s) => s.unblock);
  // The room the reporter is looking at, so a moderator can find the game. Display-only
  // context — the server treats it as opaque and never as an authorization input.
  const gameId = useUi((s) => s.gameId);
  const roomCode = useUi((s) => s.roomCode);
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState<ReportCategory>('HARASSMENT');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  if (!target) return null;
  const isBlocked = blocked.has(target.id);

  const submit = async (): Promise<void> => {
    setState('sending');
    try {
      await api.reportPlayer({
        userId: target.id,
        category,
        ...(message.trim() ? { message: message.trim() } : {}),
        ...(gameId ? { gameId } : {}),
        ...(roomCode ? { roomCode } : {}),
      });
      setState('sent');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal player-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${t('moderation.reportPlayer')} · ${target.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ticket-list-head">
          <h3>{target.name}</h3>
          <button className="icon-button" aria-label={t('close')} onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>

        {state === 'sent' ? (
          <p className="pad-done">{t('moderation.reportDone')}</p>
        ) : reporting ? (
          <div className="stack">
            <fieldset className="pad-reasons">
              <legend>{t('moderation.reportReason')}</legend>
              {REPORT_CATEGORIES.map((c) => (
                <label key={c} className={category === c ? 'pad-reason active' : 'pad-reason'}>
                  <input
                    type="radio"
                    name="report-category"
                    value={c}
                    checked={category === c}
                    onChange={() => setCategory(c)}
                  />
                  {t(`report.category_${c}`)}
                </label>
              ))}
            </fieldset>
            <textarea
              className="pad-message"
              rows={3}
              maxLength={MSG_MAX}
              placeholder={t('moderation.reportMessage')}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MSG_MAX))}
            />
            {state === 'failed' && <p className="error">{t('moderation.reportFailed')}</p>}
            <button
              className="primary"
              disabled={state === 'sending'}
              onClick={() => void submit()}
            >
              {t('moderation.reportSubmit')}
            </button>
          </div>
        ) : (
          <div className="stack">
            <button className="pad-action" onClick={() => setReporting(true)}>
              {t('moderation.reportPlayer')}
            </button>
            <button
              className="pad-action"
              onClick={() => {
                void (isBlocked ? unblock(target.id) : block(target.id));
                onClose();
              }}
            >
              {t(isBlocked ? 'moderation.unblockPlayer' : 'moderation.blockPlayer')}
            </button>
            {isBlocked && <p className="muted pad-note">{t('moderation.blockedNotice')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
