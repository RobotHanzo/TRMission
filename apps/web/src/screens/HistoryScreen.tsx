// Finished games the user played in or spectated — each row opens the replay player.
import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { api, type MatchSummary } from '../net/rest';
import { useHasFeature, useSession } from '../store/session';
import { useUi } from '../store/ui';
import { AdSlot } from '../components/AdSlot';
import '../styles/history.css';

// Drop one in-feed unit after this many rows, and only when the list is longer than this so a
// short history never gets an ad wedged into it.
const AD_AFTER_ROW = 4;

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
        {rows?.map((m, i) => (
          <Fragment key={m.gameId}>
            {i === AD_AFTER_ROW && rows.length > AD_AFTER_ROW + 1 && (
              <AdSlot placement="history" reserveHeight={120} className="history-ad" />
            )}
            <div className="history-row">
              <div className="history-meta">
                <span className="history-date">
                  {new Date(m.completedAt).toLocaleString(locale)}
                </span>
                <span className={`history-role history-role--${m.role}`}>
                  {t(m.role === 'player' ? 'history.rolePlayer' : 'history.roleSpectator')}
                </span>
              </div>
              <div className="history-players">
                {m.players.map((p) => (
                  <span
                    key={p.userId}
                    className={
                      'history-player' + (m.winners.includes(p.userId) ? ' is-winner' : '')
                    }
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
          </Fragment>
        ))}
      </div>
    </div>
  );
}
