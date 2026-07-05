import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MapAdminDetail, type MapAdminRow, type UserRow } from '../net/rest';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { fmtDateTime, shortId } from '../lib/fmt';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { MapPreview } from '../components/MapPreview';

function MapDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canModerate = useSession((s) => s.hasPermission('maps.moderate'));
  const pushToast = useToast((s) => s.push);
  const [detail, setDetail] = useState<MapAdminDetail | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingUnshare, setConfirmingUnshare] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const del = async (reason?: string) => {
    setBusy(true);
    try {
      await api.deleteMap(id, reason);
      pushToast('success', t('toast.mapDeleted'));
      onClose();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const unshare = async (reason?: string) => {
    setBusy(true);
    try {
      const updated = await api.unshareMap(id, reason).then(() => api.getMap(id));
      setDetail(updated);
      pushToast('success', t('toast.mapUnshared'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirmingUnshare(false);
    }
  };

  const transfer = async (user: UserRow) => {
    setPicking(false);
    setBusy(true);
    try {
      setDetail(await api.transferMap(id, user.id));
      pushToast('success', t('toast.mapTransferred'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

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

          {canModerate && (
            <section style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="oc-btn" disabled={busy} onClick={() => setPicking(true)}>
                {t('maps.transfer')}
              </button>
              {detail.shared && (
                <button className="oc-btn" disabled={busy} onClick={() => setConfirmingUnshare(true)}>
                  {t('maps.unshare')}
                </button>
              )}
              <button className="oc-btn danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                {t('maps.delete')}
              </button>
            </section>
          )}

          {confirmingDelete && (
            <ConfirmDialog
              title={t('maps.deleteConfirmTitle')}
              body={t('maps.deleteConfirmBody')}
              confirmLabel={t('maps.delete')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void del(reason)}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
          {confirmingUnshare && (
            <ConfirmDialog
              title={t('maps.unshareConfirmTitle')}
              body={t('maps.unshareConfirmBody')}
              confirmLabel={t('maps.unshare')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void unshare(reason)}
              onCancel={() => setConfirmingUnshare(false)}
            />
          )}
          {picking && (
            <AccountSelectorModal
              title={t('maps.transferPickTitle')}
              onSelect={(u) => void transfer(u)}
              onClose={() => setPicking(false)}
            />
          )}
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
