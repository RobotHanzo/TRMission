import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type AuditEntry } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime, shortId } from '../lib/fmt';

export function AuditView() {
  const { t, i18n } = useTranslation();
  const locale = useUi((s) => s.locale);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append: string | null) => {
    setLoading(true);
    try {
      const page = await api.listAudit(append ? { cursor: append } : {});
      setRows((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const actionLabel = (action: string): string =>
    i18n.exists(`audit.action.${action}`) ? t(`audit.action.${action}`) : action;

  return (
    <div>
      <h1 className="oc-page-title">{t('audit.title')}</h1>
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th className="num">{t('audit.colTime')}</th>
              <th>{t('audit.colActor')}</th>
              <th>{t('audit.colAction')}</th>
              <th>{t('audit.colTarget')}</th>
              <th>{t('audit.colParams')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="num">{fmtDateTime(e.at, locale)}</td>
                <td>
                  {e.actorName} <span className="oc-mono oc-muted">{shortId(e.actorId)}</span>
                </td>
                <td>{actionLabel(e.action)}</td>
                <td className="oc-mono">
                  {e.target ? `${e.target.type}:${shortId(e.target.id)}` : '—'}
                </td>
                <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                  <span className="oc-muted" style={{ fontSize: 11 }}>
                    {e.params && Object.keys(e.params).length > 0 ? JSON.stringify(e.params) : '—'}
                  </span>
                </td>
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
