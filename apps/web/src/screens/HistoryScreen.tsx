// Finished games the user played in or spectated, as a departures board: one block per day, one
// service per game, the whole row opening the replay. Grouping by day is what lets a long history
// be scanned — the date stops repeating on every line, and the time can shrink to a mono HH:MM in
// the margin where a timetable puts it.
import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { api, type MatchSummary } from '../net/rest';
import { useHasFeature, useSession } from '../store/session';
import { useUi } from '../store/ui';
import { seatColor } from '../theme/colors';
import { AdSlot } from '../components/AdSlot';
import '../styles/history.css';

// Drop one in-feed unit after this many rows, and only when the list is longer than this so a
// short history never gets an ad wedged into it.
const AD_AFTER_ROW = 4;

/** Local calendar day, as a stable grouping key (not a label). */
const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Newest-first order arrives from the API; grouping must not disturb it. */
function groupByDay(rows: MatchSummary[]): [string, MatchSummary[]][] {
  const groups: [string, MatchSummary[]][] = [];
  for (const row of rows) {
    const key = dayKey(row.completedAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === key) last[1].push(row);
    else groups.push([key, [row]]);
  }
  return groups;
}

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
    p.userId === user.id
      ? t('you')
      : p.displayName || (p.userId.startsWith('bot:') ? t('history.bot') : `P${p.seat + 1}`);

  // 24-hour clock regardless of locale convention: this is a timetable, and a column of
  // 下午09:04 / 9:04 PM neither aligns nor scans.
  const timeOf = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const dayOf = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  // Day grouping means row N is no longer "the Nth child", so the in-feed unit is pinned to the
  // game it precedes — computed once, rather than counted by a mutable index during render.
  const adBefore =
    rows && rows.length > AD_AFTER_ROW + 1 ? (rows[AD_AFTER_ROW]?.gameId ?? null) : null;

  return (
    <div className="stack history-screen">
      <h2 className="history-title">{t('history.title')}</h2>
      {error && <p className="history-error">{t('history.loadFailed')}</p>}
      {rows && rows.length === 0 && <p className="history-empty">{t('history.empty')}</p>}
      {rows &&
        groupByDay(rows).map(([key, matches]) => (
          <section className="history-day" key={key}>
            <div className="history-day-head">
              <h3>{dayOf(matches[0]!.completedAt)}</h3>
              <span className="history-day-count">{matches.length}</span>
            </div>
            <ul className="history-list">
              {matches.map((m) => {
                const scores = new Map(
                  (m.finalScores?.players ?? []).map((p) => [p.playerId, p.total]),
                );
                const winners = m.players.filter((p) => m.winners.includes(p.userId));
                // One sentence of the whole row, so the button announces what it opens rather
                // than a bag of chips read left to right.
                const label = [
                  t('history.watchReplay'),
                  timeOf(m.completedAt),
                  m.players.map(nameOf).join('、'),
                  winners.length > 0
                    ? t('history.wonBy', { name: winners.map(nameOf).join('、') })
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ');

                const inner = (
                  <>
                    <span className="history-time">{timeOf(m.completedAt)}</span>
                    <span className="history-players">
                      {m.players.map((p) => (
                        <span
                          key={p.userId}
                          className={
                            'history-player' +
                            (m.winners.includes(p.userId) ? ' is-winner' : '') +
                            (p.userId === user.id ? ' is-me' : '')
                          }
                          style={{ '--seat': seatColor(p.seat) } as CSSProperties}
                        >
                          <span className="history-livery" aria-hidden />
                          <span className="history-player-name">{nameOf(p)}</span>
                          {scores.has(p.userId) && (
                            <span className="history-player-score">{scores.get(p.userId)}</span>
                          )}
                        </span>
                      ))}
                    </span>
                    {/* Only the exception is worth a badge — "player" is what every other row is. */}
                    {m.role === 'spectator' && (
                      <span className="history-role">{t('history.roleSpectator')}</span>
                    )}
                    <Play className="history-go" size={14} aria-hidden />
                  </>
                );

                return (
                  <Fragment key={m.gameId}>
                    {m.gameId === adBefore && (
                      <li className="history-ad-row">
                        <AdSlot placement="history" reserveHeight={120} className="history-ad" />
                      </li>
                    )}
                    <li>
                      {canReplay ? (
                        <button
                          className="history-row"
                          onClick={() => enterReplay(m.gameId)}
                          disabled={!m.replayable}
                          aria-label={label}
                          title={
                            m.replayable ? t('history.watchReplay') : t('history.notReplayable')
                          }
                        >
                          {inner}
                        </button>
                      ) : (
                        <div className="history-row is-static">{inner}</div>
                      )}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
