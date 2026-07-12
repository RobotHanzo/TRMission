import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ReportRow, type ReportStatusFilter } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge } from '../components/SignalBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fmtDateTime, shortId } from '../lib/fmt';

const TABS: ReportStatusFilter[] = ['open', 'resolved', 'all'];
const TAB_KEY: Record<ReportStatusFilter, string> = {
  open: 'reports.tabOpen',
  resolved: 'reports.tabResolved',
  all: 'reports.tabAll',
};

export function ReportsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canResolve = useSession((s) => s.hasPermission('reports.resolve'));
  const [tab, setTab] = useState<ReportStatusFilter>('open');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReportRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.listReports({ status: tab, ...(after ? { cursor: after } : {}) });
        setRows((prev) => (after ? [...prev, ...page.reports] : page.reports));
        setCursor(page.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const resolve = async (row: ReportRow, note?: string) => {
    setBusy(true);
    try {
      const updated = await api.resolveReport(row.id, note);
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      setConfirming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const targetOf = (r: ReportRow): string =>
    r.kind === 'player'
      ? (r.reportedName ?? shortId(r.reportedUserId ?? ''))
      : `${r.mapNameZh ?? ''} (${r.mapNameEn ?? ''})`;
  const contextOf = (r: ReportRow): string =>
    [
      r.gameId ? `game ${shortId(r.gameId)}` : null,
      r.roomCode ? `room ${r.roomCode}` : null,
      r.shareCode ? `code ${r.shareCode}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div>
      <h1 className="oc-page-title">{t('reports.title')}</h1>
      <div className="oc-toolbar">
        <div className="oc-tabs" role="tablist">
          {TABS.map((s) => (
            <button
              key={s}
              className={tab === s ? 'active' : ''}
              onClick={() => setTab(s)}
              role="tab"
              aria-selected={tab === s}
            >
              {t(TAB_KEY[s])}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="oc-muted">{error}</p>}
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('reports.colStatus')}</th>
              <th>{t('reports.colKind')}</th>
              <th>{t('reports.colReporter')}</th>
              <th>{t('reports.colTarget')}</th>
              <th>{t('reports.colDetail')}</th>
              <th className="num">{t('reports.colCreated')}</th>
              {canResolve && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <SignalBadge
                    aspect={r.status === 'open' ? 'caution' : 'clear'}
                    label={t(r.status === 'open' ? 'reports.statusOpen' : 'reports.statusResolved')}
                  />
                </td>
                <td>
                  <span className="oc-chip">
                    {t(r.kind === 'player' ? 'reports.kindPlayer' : 'reports.kindMap')}
                  </span>{' '}
                  <span className="oc-chip">{t(`reports.category_${r.category}`)}</span>
                </td>
                <td>{r.reporterName}</td>
                <td>{targetOf(r)}</td>
                <td>
                  {contextOf(r) && (
                    <div className="oc-muted">
                      {t('reports.context')}: {contextOf(r)}
                    </div>
                  )}
                  {r.message && <div>{r.message}</div>}
                  {r.status === 'resolved' && r.resolvedByName && (
                    <div className="oc-muted">
                      {r.resolvedByName}
                      {r.resolutionNote ? ` — ${r.resolutionNote}` : ''}
                    </div>
                  )}
                </td>
                <td className="num">{fmtDateTime(r.createdAt, locale)}</td>
                {canResolve && (
                  <td>
                    {r.status === 'open' && (
                      <button className="oc-btn" onClick={() => setConfirming(r)}>
                        {t('reports.resolve')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('reports.empty')}</div>
        )}
        {cursor && (
          <div className="oc-pager">
            <button className="oc-btn" disabled={loading} onClick={() => void load(cursor)}>
              {t('reports.loadMore')}
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('reports.resolveConfirmTitle')}
          body={t('reports.resolveConfirmBody')}
          confirmLabel={t('reports.resolve')}
          withReason
          busy={busy}
          onConfirm={(note) => void resolve(confirming, note)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
