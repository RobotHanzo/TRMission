import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MapAdminDetail, type MapAdminRow } from '../net/rest';
import { useUi } from '../store/ui';
import { fmtDateTime, shortId } from '../lib/fmt';
import { Drawer } from '../components/Drawer';
import { MapPreview } from '../components/MapPreview';

function MapDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const [detail, setDetail] = useState<MapAdminDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMap(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  return (
    <Drawer title={`${t('maps.detailTitle')} · ${shortId(id)}`} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <h3>{t('maps.preview')}</h3>
            <MapPreview draft={detail.draft} />
          </section>
          <section>
            <div className="oc-kv">
              <span className="k">{t('maps.owner')}</span>
              <span className="v">{detail.ownerDisplayName ?? shortId(detail.ownerId)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.colRevision')}</span>
              <span className="v">{detail.revision}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.created')}</span>
              <span className="v">{fmtDateTime(detail.createdAt, locale)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('maps.usageCount')}</span>
              <span className="v">{detail.usageCount}</span>
            </div>
            {detail.shareCode && (
              <div className="oc-kv">
                <span className="k">{t('maps.shareCode')}</span>
                <span className="v oc-mono">{detail.shareCode}</span>
              </div>
            )}
          </section>
        </>
      )}
    </Drawer>
  );
}

export function MapsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const openDetail = useUi((s) => s.openDetail);
  const param = useUi((s) => s.param);
  const closeDetail = useUi((s) => s.closeDetail);

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

      {param && <MapDrawer id={param} onClose={closeDetail} />}
    </div>
  );
}
