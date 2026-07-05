import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type RoomRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge, aspectForStatus } from '../components/SignalBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../store/toast';
import { fmtDateTime } from '../lib/fmt';

const TABS = ['LOBBY', 'STARTED', 'CLOSED', 'all'] as const;
const TAB_KEY: Record<(typeof TABS)[number], string> = {
  LOBBY: 'rooms.tabLobby',
  STARTED: 'rooms.tabStarted',
  CLOSED: 'rooms.tabClosed',
  all: 'rooms.tabAll',
};

const statusKey = (s: string): string =>
  s === 'LOBBY'
    ? 'rooms.statusLobby'
    : s === 'STARTED'
      ? 'rooms.statusStarted'
      : 'rooms.statusClosed';

export function RoomsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
  const pushToast = useToast((s) => s.push);

  const [rows, setRows] = useState<RoomRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listRooms({ status: tab, ...(append ? { cursor: append } : {}) });
        setRows((prev) => (append ? [...prev, ...page.rooms] : page.rooms));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const close = async (code: string, reason?: string) => {
    setBusy(true);
    try {
      const updated = await api.closeRoom(code, reason);
      setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
      pushToast('success', t('toast.roomClosed'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setClosing(null);
    }
  };

  const del = async (code: string, reason?: string) => {
    setBusy(true);
    try {
      await api.deleteRoom(code, reason);
      setRows((prev) => prev.filter((r) => r.code !== code));
      pushToast('success', t('toast.roomDeleted'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <div>
      <h1 className="oc-page-title">{t('rooms.title')}</h1>
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

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('rooms.colRoom')}</th>
              <th>{t('rooms.colStatus')}</th>
              <th className="num">{t('rooms.colMembers')}</th>
              <th>{t('rooms.colVisibility')}</th>
              <th className="num">{t('rooms.colUpdated')}</th>
              {(canClose || canDelete) && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="oc-mono">{r.code}</td>
                <td>
                  <SignalBadge aspect={aspectForStatus(r.status)} label={t(statusKey(r.status))} />
                </td>
                <td className="num">
                  {r.memberCount}/{r.maxPlayers}
                </td>
                <td>{r.visibility === 'PUBLIC' ? t('rooms.visPublic') : t('rooms.visInvite')}</td>
                <td className="num">{fmtDateTime(r.updatedAt, locale)}</td>
                {(canClose || canDelete) && (
                  <td>
                    {canClose && r.status === 'LOBBY' && (
                      <button className="oc-btn danger" onClick={() => setClosing(r.code)}>
                        {t('rooms.close')}
                      </button>
                    )}
                    {canClose && r.status === 'STARTED' && (
                      <span className="oc-muted" style={{ fontSize: 11 }}>
                        {t('rooms.startedHint')}
                      </span>
                    )}
                    {canDelete && (
                      <button
                        className="oc-btn danger"
                        style={{ marginLeft: 6 }}
                        onClick={() => setDeleting(r.code)}
                      >
                        {t('rooms.delete')}
                      </button>
                    )}
                  </td>
                )}
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

      {closing && (
        <ConfirmDialog
          title={t('rooms.closeConfirmTitle')}
          body={t('rooms.closeConfirmBody')}
          confirmLabel={t('rooms.close')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void close(closing, reason)}
          onCancel={() => setClosing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('rooms.deleteConfirmTitle')}
          body={
            rows.find((r) => r.code === deleting)?.status === 'STARTED'
              ? t('rooms.deleteConfirmBodyStarted')
              : t('rooms.deleteConfirmBody')
          }
          confirmLabel={t('rooms.delete')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void del(deleting, reason)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
