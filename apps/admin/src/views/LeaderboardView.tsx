import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api,
  type LeaderboardMetric,
  type LeaderboardRow,
  type LeaderboardScopeKind,
} from '../net/rest';
import { shortId } from '../lib/fmt';

const METRICS: LeaderboardMetric[] = ['rating', 'wins', 'gamesPlayed'];
const SCOPES: LeaderboardScopeKind[] = ['allTime', 'season'];

export function LeaderboardView() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<LeaderboardScopeKind>('allTime');
  const [metric, setMetric] = useState<LeaderboardMetric>('rating');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listLeaderboard({
          scope,
          metric,
          ...(append ? { cursor: append } : {}),
        });
        setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [scope, metric],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('leaderboard.title')}</h1>
      <div className="oc-toolbar">
        <div className="oc-tabs" role="tablist" aria-label={t('leaderboard.title')}>
          {SCOPES.map((s) => (
            <button
              key={s}
              className={scope === s ? 'active' : ''}
              onClick={() => setScope(s)}
              role="tab"
              aria-selected={scope === s}
            >
              {t(`leaderboard.scope${s === 'allTime' ? 'AllTime' : 'Season'}`)}
            </button>
          ))}
        </div>
        <div className="oc-tabs" role="tablist" aria-label={t('leaderboard.colRank')}>
          {METRICS.map((m) => (
            <button
              key={m}
              className={metric === m ? 'active' : ''}
              onClick={() => setMetric(m)}
              role="tab"
              aria-selected={metric === m}
            >
              {t(`leaderboard.metric${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th className="num">{t('leaderboard.colRank')}</th>
              <th>{t('leaderboard.colUser')}</th>
              <th className="num">{t('leaderboard.colRating')}</th>
              <th className="num">{t('leaderboard.colWins')}</th>
              <th className="num">{t('leaderboard.colLosses')}</th>
              <th className="num">{t('leaderboard.colGamesPlayed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="num">{r.rank}</td>
                <td>
                  {r.displayName ?? shortId(r.userId)}{' '}
                  <span className="oc-mono oc-muted">{shortId(r.userId)}</span>
                </td>
                <td className="num">{r.rating}</td>
                <td className="num">{r.wins}</td>
                <td className="num">{r.losses}</td>
                <td className="num">{r.gamesPlayed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
        )}
        {cursor && (
          <div className="oc-pager">
            <button className="oc-btn" disabled={loading} onClick={() => void load(cursor)}>
              {t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
