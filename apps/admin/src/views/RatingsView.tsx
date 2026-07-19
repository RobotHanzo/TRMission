import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type RatingRow } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime, shortId } from '../lib/fmt';

export function RatingsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [avgStars, setAvgStars] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append: string | null) => {
    setLoading(true);
    try {
      const page = await api.listRatings(append ? { cursor: append } : {});
      setRows((prev) => (append ? [...prev, ...page.ratings] : page.ratings));
      setCursor(page.nextCursor);
      setAvgStars(page.avgStars);
      setTotalCount(page.totalCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('ratings.title')}</h1>
      <p className="oc-muted">
        {t('ratings.summary', {
          avg: avgStars !== null ? avgStars.toFixed(1) : '—',
          count: totalCount,
        })}
      </p>
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('ratings.colStars')}</th>
              <th>{t('ratings.colUser')}</th>
              <th>{t('ratings.colFeedback')}</th>
              <th>{t('ratings.colGame')}</th>
              <th>{t('ratings.colRoom')}</th>
              <th className="num">{t('ratings.colSubmitted')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {'★'.repeat(r.stars)}
                  {'☆'.repeat(5 - r.stars)}
                </td>
                <td>
                  {r.userDisplayName ?? shortId(r.userId)}{' '}
                  <span className="oc-mono oc-muted">{shortId(r.userId)}</span>
                </td>
                <td>{r.text && <div>{r.text}</div>}</td>
                <td className="oc-mono">{shortId(r.gameId)}</td>
                <td className="oc-mono">{r.roomId}</td>
                <td className="num">{fmtDateTime(r.createdAt, locale)}</td>
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
