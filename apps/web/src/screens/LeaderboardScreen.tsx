// Player leaderboard: rating (main "ranking points" board), wins, and games-played, each
// all-time or this season. Registered users only — guests/bots never appear as rows.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeaderboardEntry, LeaderboardMetric, LeaderboardScopeKind } from '../net/rest';
import { api } from '../net/rest';
import { useSession } from '../store/session';
import '../styles/leaderboard.css';

const SCOPES: LeaderboardScopeKind[] = ['allTime', 'season'];
const METRICS: LeaderboardMetric[] = ['rating', 'wins', 'gamesPlayed'];
const METRIC_KEY: Record<LeaderboardMetric, string> = {
  rating: 'leaderboard.metricRating',
  wins: 'leaderboard.metricWins',
  gamesPlayed: 'leaderboard.metricGamesPlayed',
};

export function LeaderboardScreen() {
  const { t } = useTranslation();
  const user = useSession((s) => s.user);
  const [scope, setScope] = useState<LeaderboardScopeKind>('allTime');
  const [metric, setMetric] = useState<LeaderboardMetric>('rating');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [mine, setMine] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    (append: string | null) => {
      setLoading(true);
      setError(false);
      return Promise.all([
        api.leaderboard({ scope, metric, ...(append ? { cursor: append } : {}) }),
        append ? null : api.myLeaderboardStanding({ scope, metric }),
      ])
        .then(([page, standing]) => {
          setRows((prev) => (append ? [...(prev ?? []), ...page.rows] : page.rows));
          setCursor(page.nextCursor);
          if (!append) setMine(standing?.standing ?? null);
        })
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    },
    [scope, metric],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const metricValue = (r: LeaderboardEntry): number =>
    metric === 'rating' ? r.rating : metric === 'wins' ? r.wins : r.gamesPlayed;

  const inVisiblePage = !!user && !!rows?.some((r) => r.userId === user.id);

  return (
    <div className="stack leaderboard-screen">
      <div className="card">
        <h2>{t('leaderboard.title')}</h2>
        <div className="leaderboard-toggle-row">
          <div className="leaderboard-toggle-group" role="tablist">
            {SCOPES.map((s) => (
              <button
                key={s}
                className={scope === s ? 'is-active' : ''}
                role="tab"
                aria-selected={scope === s}
                onClick={() => setScope(s)}
              >
                {t(s === 'allTime' ? 'leaderboard.scopeAllTime' : 'leaderboard.scopeSeason')}
              </button>
            ))}
          </div>
          <div className="leaderboard-toggle-group" role="tablist">
            {METRICS.map((m) => (
              <button
                key={m}
                className={metric === m ? 'is-active' : ''}
                role="tab"
                aria-selected={metric === m}
                onClick={() => setMetric(m)}
              >
                {t(METRIC_KEY[m])}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="leaderboard-error">{t('leaderboard.loadFailed')}</p>}
        {rows && rows.length === 0 && <p className="leaderboard-empty">{t('leaderboard.empty')}</p>}

        {mine && !inVisiblePage && (
          <div className="leaderboard-row leaderboard-row--mine leaderboard-row--pinned">
            <span className="leaderboard-rank">#{mine.rank}</span>
            <span className="leaderboard-name">
              {mine.displayName ?? t('leaderboard.you')} · {t('leaderboard.you')}
            </span>
            <span className="leaderboard-value">{metricValue(mine)}</span>
          </div>
        )}
        {user && !mine && rows && (
          <p className="leaderboard-not-ranked">{t('leaderboard.notRankedYet')}</p>
        )}

        {rows?.map((r) => (
          <div
            key={r.userId}
            className={
              'leaderboard-row' + (user && r.userId === user.id ? ' leaderboard-row--mine' : '')
            }
          >
            <span className="leaderboard-rank">#{r.rank}</span>
            <span className="leaderboard-name">{r.displayName ?? r.userId}</span>
            <span className="leaderboard-value">{metricValue(r)}</span>
          </div>
        ))}

        {cursor && (
          <div className="leaderboard-pager">
            <button disabled={loading} onClick={() => void load(cursor)}>
              {t('leaderboard.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
