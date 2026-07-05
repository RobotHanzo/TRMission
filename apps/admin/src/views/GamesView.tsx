import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type GameDetail, type GameLogEntry, type GameRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge, aspectForStatus } from '../components/SignalBadge';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../store/toast';
import { fmtDateTime, shortId } from '../lib/fmt';
import { chatPresetKey } from '../game/chatPresets';

const TABS = ['LIVE', 'COMPLETED', 'TERMINATED', 'all'] as const;
const TAB_KEY: Record<(typeof TABS)[number], string> = {
  LIVE: 'games.tabLive',
  COMPLETED: 'games.tabCompleted',
  TERMINATED: 'games.tabTerminated',
  all: 'games.tabAll',
};

const statusKey = (s: string): string =>
  s === 'LIVE'
    ? 'games.statusLive'
    : s === 'COMPLETED'
      ? 'games.statusCompleted'
      : 'games.statusTerminated';

function GameDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canTerminate = useSession((s) => s.hasPermission('games.terminate'));
  const canDelete = useSession((s) => s.hasPermission('games.delete'));
  const canReadLog = useSession((s) => s.hasPermission('games.readLog'));
  const pushToast = useToast((s) => s.push);
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [log, setLog] = useState<GameLogEntry[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getGame(id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  const loadLog = async () => {
    try {
      setLog((await api.getGameLog(id)).entries);
    } catch (e) {
      if (e instanceof ApiError) setLog([]);
    }
  };

  const terminate = async (reason?: string) => {
    setBusy(true);
    try {
      setDetail(await api.terminateGame(id, reason));
      pushToast('success', t('toast.gameTerminated'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const del = async (reason?: string) => {
    setBusy(true);
    try {
      await api.deleteGame(id, reason);
      pushToast('success', t('toast.gameDeleted'));
      onClose();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Drawer title={`${t('games.detailTitle')} · ${shortId(id)}`} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <div className="oc-kv">
              <span className="k">{t('games.colStatus')}</span>
              <span className="v">
                <SignalBadge
                  aspect={aspectForStatus(detail.status)}
                  label={t(statusKey(detail.status))}
                />
                {detail.inMemory ? ` · ${t('games.inMemory')}` : ''}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">ID</span>
              <span className="v" title={detail.gameId}>
                {detail.gameId}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('games.colSeq')}</span>
              <span className="v">{detail.currentSeq}</span>
            </div>
            {detail.roomCode && (
              <div className="oc-kv">
                <span className="k">{t('games.room')}</span>
                <span className="v">{detail.roomCode}</span>
              </div>
            )}
            <div className="oc-kv">
              <span className="k">{t('games.seed')}</span>
              <span className="v">
                {detail.seed !== undefined ? (
                  String(detail.seed)
                ) : (
                  <span className="oc-muted">{t('games.seedHidden')}</span>
                )}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('overview.engine')}</span>
              <span className="v">v{detail.engineVersion}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('games.colUpdated')}</span>
              <span className="v">{fmtDateTime(detail.updatedAt, locale)}</span>
            </div>
          </section>

          {detail.terminated && (
            <section>
              <h3>{t('games.statusTerminated')}</h3>
              <div className="oc-kv">
                <span className="k">{t('games.terminatedBy')}</span>
                <span className="v">{shortId(detail.terminated.by)}</span>
              </div>
              {detail.terminated.reason && (
                <div className="oc-kv">
                  <span className="k">{t('games.terminatedReason')}</span>
                  <span className="v">{detail.terminated.reason}</span>
                </div>
              )}
            </section>
          )}

          <section>
            <h3>{t('games.players')}</h3>
            {detail.players.map((p) => (
              <div className="oc-kv" key={p.id}>
                <span className="k">
                  P{p.seat + 1} {p.displayName ?? shortId(p.id)}
                </span>
                <span className="v">{p.isBot ? `${t('games.bot')} · ${p.difficulty}` : ''}</span>
              </div>
            ))}
            {detail.spectators.length > 0 && (
              <div className="oc-kv">
                <span className="k">{t('games.spectators')}</span>
                <span className="v">{detail.spectators.length}</span>
              </div>
            )}
          </section>

          <section>
            <h3>{t('games.chat')}</h3>
            {detail.chat.length === 0 ? (
              <p className="oc-muted">{t('games.chatEmpty')}</p>
            ) : (
              detail.chat.map((c, i) => (
                <div className="oc-kv" key={i}>
                  <span className="k oc-mono">{shortId(c.playerId)}</span>
                  <span className="v" style={{ fontFamily: 'inherit' }}>
                    {c.kind === 'preset' ? (
                      <>
                        {t(chatPresetKey(c.value))}{' '}
                        <span className="oc-chip">{t('games.chatPresetBadge')}</span>
                      </>
                    ) : (
                      c.value
                    )}
                  </span>
                </div>
              ))
            )}
          </section>

          {canReadLog && (
            <section>
              <h3>{t('games.log')}</h3>
              {detail.status !== 'COMPLETED' ? (
                <p className="oc-muted">{t('games.logHint')}</p>
              ) : log === null ? (
                <button className="oc-btn" onClick={() => void loadLog()}>
                  {t('games.log')}
                </button>
              ) : (
                <div style={{ maxHeight: 280, overflow: 'auto' }}>
                  {log.map((e) => (
                    <div className="oc-kv" key={e.seq}>
                      <span className="k oc-mono">#{e.seq}</span>
                      <span className="v" title={e.stateDigest}>
                        {(e.action as { t?: string }).t ?? '?'} · {e.stateDigest.slice(0, 8)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {canTerminate && detail.status === 'LIVE' && (
            <section>
              <button className="oc-btn danger" disabled={busy} onClick={() => setConfirming(true)}>
                {t('games.terminate')}
              </button>
            </section>
          )}

          {canDelete && (
            <section>
              <button
                className="oc-btn danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t('games.delete')}
              </button>
            </section>
          )}

          {confirming && (
            <ConfirmDialog
              title={t('games.terminateConfirmTitle')}
              body={t('games.terminateConfirmBody')}
              confirmLabel={t('games.terminate')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void terminate(reason)}
              onCancel={() => setConfirming(false)}
            />
          )}

          {confirmingDelete && (
            <ConfirmDialog
              title={t('games.deleteConfirmTitle')}
              body={
                detail.status === 'LIVE'
                  ? t('games.deleteConfirmBodyLive')
                  : t('games.deleteConfirmBody')
              }
              confirmLabel={t('games.delete')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void del(reason)}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
        </>
      )}
    </Drawer>
  );
}

export function GamesView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const param = useUi((s) => s.param);
  const openDetail = useUi((s) => s.openDetail);
  const closeDetail = useUi((s) => s.closeDetail);

  const [rows, setRows] = useState<GameRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('LIVE');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listGames({ status: tab, ...(append ? { cursor: append } : {}) });
        setRows((prev) => (append ? [...prev, ...page.games] : page.games));
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

  return (
    <div>
      <h1 className="oc-page-title">{t('games.title')}</h1>
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
              <th>{t('games.colGame')}</th>
              <th>{t('games.colStatus')}</th>
              <th className="num">{t('games.colSeq')}</th>
              <th className="num">{t('games.colPlayers')}</th>
              <th className="num">{t('games.colBots')}</th>
              <th className="num">{t('games.colUpdated')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr
                key={g.gameId}
                className="clickable"
                onClick={() => openDetail('games', g.gameId)}
              >
                <td className="oc-mono">{shortId(g.gameId)}</td>
                <td>
                  <SignalBadge aspect={aspectForStatus(g.status)} label={t(statusKey(g.status))} />
                  {g.inMemory && <span className="oc-muted"> · {t('games.inMemory')}</span>}
                </td>
                <td className="num">{g.currentSeq}</td>
                <td className="num">{g.playerCount}</td>
                <td className="num">{g.botCount}</td>
                <td className="num">{fmtDateTime(g.updatedAt, locale)}</td>
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

      {param && <GameDrawer id={param} onClose={closeDetail} />}
    </div>
  );
}
