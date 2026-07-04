// Finished games the user played in or spectated — each row opens the replay player.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { api, type MatchSummary } from '../net/rest';
import { useHasFeature, useSession } from '../store/session';
import { useUi } from '../store/ui';
import '../styles/history.css';

export function HistoryScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const canReplay = useHasFeature('replayReview');
  const enterReplay = useUi((s) => s.enterReplay);
  const locale = useUi((s) => s.locale);
  const [rows, setRows] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .history()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  const nameOf = (p: MatchSummary['players'][number]): string =>
    p.displayName || (p.userId.startsWith('bot:') ? t('history.bot') : `P${p.seat + 1}`);

  return (
    <div className="stack history-screen">
      <div className="card">
        <h2>{t('history.title')}</h2>
        {error && <p className="history-error">{t('history.loadFailed')}</p>}
        {rows && rows.length === 0 && <p className="history-empty">{t('history.empty')}</p>}
        {rows?.map((m) => (
          <div className="history-row" key={m.gameId}>
            <div className="history-meta">
              <span className="history-date">{new Date(m.completedAt).toLocaleString(locale)}</span>
              <span className={`history-role history-role--${m.role}`}>
                {t(m.role === 'player' ? 'history.rolePlayer' : 'history.roleSpectator')}
              </span>
            </div>
            <div className="history-players">
              {m.players.map((p) => (
                <span
                  key={p.userId}
                  className={'history-player' + (m.winners.includes(p.userId) ? ' is-winner' : '')}
                >
                  {nameOf(p)}
                </span>
              ))}
            </div>
            {canReplay && (
              <button
                onClick={() => enterReplay(m.gameId)}
                disabled={!m.replayable}
                title={m.replayable ? t('history.watchReplay') : t('history.notReplayable')}
              >
                <Play size={14} aria-hidden /> {t('history.watchReplay')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
