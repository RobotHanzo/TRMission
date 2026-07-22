import { useCallback, useEffect, useState } from 'react';
import { Crown, DoorClosed, Info, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type RoomDetail, type RoomRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge, aspectForStatus } from '../components/SignalBadge';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../store/toast';
import { fmtDateTime, shortId } from '../lib/fmt';

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

function RoomDrawer({
  row,
  onClose,
  onRequestClose,
  onRequestDelete,
  onRequestTransfer,
}: {
  row: RoomRow;
  onClose: () => void;
  onRequestClose: (code: string) => void;
  onRequestDelete: (code: string) => void;
  onRequestTransfer: (code: string, userId: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
  const canTransferHost = useSession((s) => s.hasPermission('rooms.transferHost'));
  const [detail, setDetail] = useState<RoomDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getRoom(row.code)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
  }, [row.code, onClose]);

  const flag = (on: boolean): string => (on ? t('rooms.on') : t('rooms.off'));

  return (
    <Drawer title={`${t('rooms.detailTitle')} · ${row.code}`} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <div className="oc-kv">
              <span className="k">{t('rooms.colStatus')}</span>
              <span className="v">
                <SignalBadge
                  aspect={aspectForStatus(row.status)}
                  label={t(statusKey(row.status))}
                />
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.host')}</span>
              <span className="v">{detail.hostName ?? shortId(detail.hostId)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.colVisibility')}</span>
              <span className="v">
                {detail.visibility === 'PUBLIC' ? t('rooms.visPublic') : t('rooms.visInvite')}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.colMembers')}</span>
              <span className="v">
                {row.memberCount}/{detail.maxPlayers}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.created')}</span>
              <span className="v">{fmtDateTime(detail.createdAt, locale)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.updated')}</span>
              <span className="v">{fmtDateTime(detail.updatedAt, locale)}</span>
            </div>
          </section>

          {detail.gameId && (
            <section>
              <h3>{t('rooms.linkedGame')}</h3>
              <div className="oc-kv">
                <span className="k">ID</span>
                <span className="v oc-mono" title={detail.gameId}>
                  {shortId(detail.gameId)}
                </span>
              </div>
              {detail.gameStatus && (
                <div className="oc-kv">
                  <span className="k">{t('rooms.gameStatus')}</span>
                  <span className="v">{detail.gameStatus}</span>
                </div>
              )}
            </section>
          )}

          <section>
            <h3>{t('rooms.members')}</h3>
            {detail.members.map((m) => (
              <div className="oc-kv" key={m.userId}>
                <span className="k">
                  P{m.seat + 1} {m.displayName}
                </span>
                <span className="v">
                  {m.isBot
                    ? `${t('rooms.bot')}${m.difficulty ? ` · ${m.difficulty}` : ''}`
                    : m.isGuest
                      ? t('rooms.guest')
                      : ''}{' '}
                  <span className="oc-muted">
                    {m.ready ? t('rooms.ready') : t('rooms.notReady')}
                  </span>
                  {canTransferHost &&
                    row.status === 'LOBBY' &&
                    !m.isBot &&
                    m.userId !== detail.hostId && (
                      <button
                        className="oc-btn"
                        style={{ marginLeft: 6 }}
                        onClick={() => onRequestTransfer(row.code, m.userId)}
                      >
                        <Crown size={14} aria-hidden />
                        {t('rooms.transferHost')}
                      </button>
                    )}
                </span>
              </div>
            ))}
            {detail.spectators.length > 0 && (
              <div className="oc-kv">
                <span className="k">{t('rooms.spectators')}</span>
                <span className="v">{detail.spectators.length}</span>
              </div>
            )}
          </section>

          <section>
            <h3>{t('rooms.settings')}</h3>
            <div className="oc-kv">
              <span className="k">{t('rooms.map')}</span>
              <span className="v">
                {detail.settings.map.source === 'custom'
                  ? `${t('rooms.mapCustom')} · ${shortId(detail.settings.map.id)}`
                  : `${t('rooms.mapOfficial')} · ${detail.settings.map.id}`}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.allowSpectating')}</span>
              <span className="v">{flag(detail.settings.allowSpectating)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.eventsMode')}</span>
              <span className="v">{detail.settings.eventsMode}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.teamCount')}</span>
              <span className="v">{detail.settings.teamCount || '—'}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagUnlimitedStationBorrow')}</span>
              <span className="v">{flag(detail.settings.unlimitedStationBorrow)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagSecondDrawAfterBlindRainbow')}</span>
              <span className="v">{flag(detail.settings.secondDrawAfterBlindRainbow)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagNoUnfinishedTicketPenalty')}</span>
              <span className="v">{flag(detail.settings.noUnfinishedTicketPenalty)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagDoubleRouteSingleFor23')}</span>
              <span className="v">{flag(detail.settings.doubleRouteSingleFor23)}</span>
            </div>
          </section>

          {canClose && row.status === 'LOBBY' && (
            <section>
              <button className="oc-btn danger" onClick={() => onRequestClose(row.code)}>
                <DoorClosed size={14} aria-hidden />
                {t('rooms.close')}
              </button>
            </section>
          )}
          {canDelete && (
            <section>
              <button className="oc-btn danger" onClick={() => onRequestDelete(row.code)}>
                <Trash2 size={14} aria-hidden />
                {t('rooms.delete')}
              </button>
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}

export function RoomsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const param = useUi((s) => s.param);
  const openDetail = useUi((s) => s.openDetail);
  const closeDetail = useUi((s) => s.closeDetail);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
  const pushToast = useToast((s) => s.push);

  const [rows, setRows] = useState<RoomRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [transferring, setTransferring] = useState<{ code: string; userId: string } | null>(null);
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

  const transferHost = async (code: string, userId: string, reason?: string) => {
    setBusy(true);
    try {
      const updated = await api.transferRoomHost(code, userId, reason);
      setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
      if (param === code) closeDetail();
      pushToast('success', t('toast.roomHostTransferred'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setTransferring(null);
    }
  };

  const del = async (code: string, reason?: string) => {
    setBusy(true);
    try {
      await api.deleteRoom(code, reason);
      setRows((prev) => prev.filter((r) => r.code !== code));
      if (param === code) closeDetail();
      pushToast('success', t('toast.roomDeleted'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  const openRow = param ? rows.find((r) => r.code === param) : undefined;

  return (
    <div>
      <h1 className="oc-page-title">
        {t('rooms.title')}
        {canClose && (
          <span className="oc-info-hint" title={t('rooms.startedHint')}>
            <Info size={14} aria-hidden />
          </span>
        )}
      </h1>
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
              <tr key={r.code} className="clickable" onClick={() => openDetail('rooms', r.code)}>
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
                      <button
                        className="oc-btn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setClosing(r.code);
                        }}
                      >
                        <DoorClosed size={14} aria-hidden />
                        {t('rooms.close')}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="oc-btn danger"
                        style={canClose && r.status === 'LOBBY' ? { marginLeft: 6 } : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(r.code);
                        }}
                      >
                        <Trash2 size={14} aria-hidden />
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

      {openRow && (
        <RoomDrawer
          row={openRow}
          onClose={closeDetail}
          onRequestClose={setClosing}
          onRequestDelete={setDeleting}
          onRequestTransfer={(code, userId) => setTransferring({ code, userId })}
        />
      )}

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
      {transferring && (
        <ConfirmDialog
          title={t('rooms.transferConfirmTitle')}
          body={t('rooms.transferConfirmBody')}
          confirmLabel={t('rooms.transferHost')}
          withReason
          busy={busy}
          onConfirm={(reason) => void transferHost(transferring.code, transferring.userId, reason)}
          onCancel={() => setTransferring(null)}
        />
      )}
    </div>
  );
}
