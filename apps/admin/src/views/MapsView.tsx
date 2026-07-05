import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MapAdminRow } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime } from '../lib/fmt';

export function MapsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const openDetail = useUi((s) => s.openDetail);

  const [rows, setRows] = useState<MapAdminRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append: string | null) => {
    setLoading(true);
    try {
      const page = await api.listMaps(append ? { cursor: append } : {});
      setRows((prev) => (append ? [...prev, ...page.maps] : page.maps));
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('maps.title')}</h1>
      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('maps.colName')}</th>
              <th>{t('maps.colOwner')}</th>
              <th className="num">{t('maps.colRevision')}</th>
              <th>{t('maps.colShared')}</th>
              <th className="num">{t('maps.colUpdated')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="clickable" onClick={() => openDetail('maps', m.id)}>
                <td>{m.nameEn || m.nameZh}</td>
                <td>{m.ownerDisplayName ?? m.ownerId}</td>
                <td className="num">{m.revision}</td>
                <td>{m.shared ? t('maps.sharedYes') : t('maps.sharedNo')}</td>
                <td className="num">{fmtDateTime(m.updatedAt, locale)}</td>
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
