import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserDetail, type UserFilter, type UserRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge } from '../components/SignalBadge';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FeatureToggles } from '../components/FeatureToggles';
import { OAuthBadges } from '../components/OAuthBadges';
import { useToast } from '../store/toast';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { fmtDateTime, shortId } from '../lib/fmt';

const FILTERS: UserFilter[] = ['all', 'guests', 'registered', 'disabled'];
const FILTER_KEY: Record<UserFilter, string> = {
  all: 'users.filterAll',
  guests: 'users.filterGuests',
  registered: 'users.filterRegistered',
  disabled: 'users.filterDisabled',
};

function ExpiresCell({
  guestExpiresAt,
  disabledAt,
  locale,
}: {
  guestExpiresAt: string | undefined;
  disabledAt: string | undefined;
  locale: string;
}) {
  const { t } = useTranslation();
  if (!guestExpiresAt) return <span className="oc-muted">—</span>;
  return (
    <>
      {fmtDateTime(guestExpiresAt, locale)}
      {disabledAt && <span className="oc-muted"> {t('users.expiresDisabledSuffix')}</span>}
    </>
  );
}

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canBan = useSession((s) => s.hasPermission('users.ban'));
  const canDelete = useSession((s) => s.hasPermission('users.delete'));
  const canFeatures = useSession((s) => s.hasPermission('users.features'));
  const pushToast = useToast((s) => s.push);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getUser(id));
    } catch {
      onClose();
    }
  }, [id, onClose]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleBan = async (reason?: string) => {
    if (!detail) return;
    const wasBanned = Boolean(detail.disabledAt);
    setBusy(true);
    try {
      const next = wasBanned
        ? await api.enableUser(detail.id)
        : await api.disableUser(detail.id, reason);
      setDetail(next);
      pushToast('success', t(wasBanned ? 'toast.userUnbanned' : 'toast.userBanned'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const removeUser = async (reason?: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteUser(detail.id, reason);
      pushToast('success', t('toast.userDeleted'));
      onClose();
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <Drawer title={detail?.displayName ?? t('common.loading')} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <div className="oc-kv">
              <span className="k">ID</span>
              <span className="v" title={detail.id}>
                {detail.id}
              </span>
            </div>
            {detail.email && (
              <div className="oc-kv">
                <span className="k">{t('users.colEmail')}</span>
                <span className="v">{detail.email}</span>
              </div>
            )}
            <div className="oc-kv">
              <span className="k">{t('users.colKind')}</span>
              <span className="v">
                {detail.isGuest ? t('users.guest') : t('users.registered')}
                {detail.isMaintainer ? ` · ${t('users.maintainerBadge')}` : ''}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('users.colCreated')}</span>
              <span className="v">{fmtDateTime(detail.createdAt, locale)}</span>
            </div>
            {detail.locale && (
              <div className="oc-kv">
                <span className="k">{t('users.locale')}</span>
                <span className="v">{detail.locale}</span>
              </div>
            )}
            {(detail.oauthProviders.length > 0 || detail.hasPassword) && (
              <div className="oc-kv">
                <span className="k">{t('users.oauth')}</span>
                <span className="v">
                  <OAuthBadges
                    oauthProviders={detail.oauthProviders}
                    hasPassword={detail.hasPassword}
                  />
                </span>
              </div>
            )}
            {detail.isGuest && detail.guestExpiresAt && (
              <div className="oc-kv">
                <span className="k">{t('users.colExpires')}</span>
                <span className="v">
                  <ExpiresCell
                    guestExpiresAt={detail.guestExpiresAt}
                    disabledAt={detail.disabledAt}
                    locale={locale}
                  />
                </span>
              </div>
            )}
            <div className="oc-kv">
              <span className="k">{t('users.sessions')}</span>
              <span className="v">{detail.activeSessions}</span>
            </div>
          </section>

          {detail.disabledAt && (
            <section>
              <h3>{t('users.disabledBadge')}</h3>
              <div className="oc-kv">
                <span className="k">{t('users.disabledBy')}</span>
                <span className="v">{shortId(detail.disabledBy ?? '')}</span>
              </div>
              {detail.disabledReason && (
                <div className="oc-kv">
                  <span className="k">{t('users.disabledReason')}</span>
                  <span className="v">{detail.disabledReason}</span>
                </div>
              )}
            </section>
          )}

          {detail.activeRooms.length > 0 && (
            <section>
              <h3>{t('users.activeRooms')}</h3>
              {detail.activeRooms.map((r) => (
                <div className="oc-kv" key={r.code}>
                  <span className="k oc-mono">{r.code}</span>
                  <span className="v">{r.status}</span>
                </div>
              ))}
            </section>
          )}

          <section>
            <h3>
              {t('users.history')} ({detail.history.length})
            </h3>
            {(detail.history as { gameId: string; completedAt: string; winners: string[] }[])
              .slice(0, 10)
              .map((h) => (
                <div className="oc-kv" key={h.gameId}>
                  <span className="k oc-mono">{shortId(h.gameId)}</span>
                  <span className="v">
                    {fmtDateTime(h.completedAt, locale)}
                    {h.winners.includes(detail.id) ? ` · ${t('users.wins')}` : ''}
                  </span>
                </div>
              ))}
          </section>

          {canFeatures && !detail.isGuest && (
            <section>
              <h3>{t('features.title')}</h3>
              <FeatureToggles
                key={detail.features.join(',')}
                userId={detail.id}
                initial={detail.features}
                onSaved={setDetail}
              />
            </section>
          )}

          {canBan && !detail.isMaintainer && (
            <section>
              {detail.disabledAt ? (
                <button className="oc-btn" disabled={busy} onClick={() => void toggleBan()}>
                  {t('users.enable')}
                </button>
              ) : (
                <button
                  className="oc-btn danger"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  {t('users.disable')}
                </button>
              )}
            </section>
          )}

          {canDelete && !detail.isMaintainer && (
            <section>
              <button
                className="oc-btn danger"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                {t('users.delete')}
              </button>
            </section>
          )}

          {confirming && (
            <ConfirmDialog
              title={t('users.disableConfirmTitle')}
              body={t('users.disableConfirmBody')}
              confirmLabel={t('users.disable')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void toggleBan(reason)}
              onCancel={() => setConfirming(false)}
            />
          )}

          {confirmingDelete && (
            <ConfirmDialog
              title={t('users.deleteConfirmTitle')}
              body={t('users.deleteConfirmBody')}
              confirmLabel={t('users.delete')}
              danger
              withReason
              busy={busy}
              onConfirm={(reason) => void removeUser(reason)}
              onCancel={() => setConfirmingDelete(false)}
            />
          )}
        </>
      )}
    </Drawer>
  );
}

export function UsersView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const param = useUi((s) => s.param);
  const openDetail = useUi((s) => s.openDetail);
  const closeDetail = useUi((s) => s.closeDetail);

  const [rows, setRows] = useState<UserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<UserFilter>('all');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, q.trim() ? 300 : 0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listUsers({
          ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
          filter,
          ...(append ? { cursor: append } : {}),
        });
        setRows((prev) => (append ? [...prev, ...page.users] : page.users));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [filter, debouncedQ],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('users.title')}</h1>
      <div className="oc-toolbar">
        <input
          type="search"
          placeholder={t('users.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')}
        />
        <div className="oc-tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
              role="tab"
              aria-selected={filter === f}
            >
              {t(FILTER_KEY[f])}
            </button>
          ))}
        </div>
      </div>

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('users.colUser')}</th>
              <th>{t('users.colEmail')}</th>
              <th>{t('users.colKind')}</th>
              <th>{t('users.colOauth')}</th>
              <th>{t('users.colStatus')}</th>
              <th>{t('users.colCreated')}</th>
              <th>{t('users.colExpires')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => openDetail('users', u.id)}>
                <td>
                  {u.displayName} <span className="oc-mono oc-muted">{shortId(u.id)}</span>
                </td>
                <td>{u.email ?? <span className="oc-muted">—</span>}</td>
                <td>{u.isGuest ? t('users.guest') : t('users.registered')}</td>
                <td>
                  <OAuthBadges oauthProviders={u.oauthProviders} hasPassword={u.hasPassword} />
                </td>
                <td>
                  {u.disabledAt ? (
                    <SignalBadge aspect="stop" label={t('users.disabledBadge')} />
                  ) : (
                    <SignalBadge aspect="clear" label={t('users.active')} />
                  )}
                </td>
                <td className="num">{fmtDateTime(u.createdAt, locale)}</td>
                <td className="num">
                  <ExpiresCell
                    guestExpiresAt={u.guestExpiresAt}
                    disabledAt={u.disabledAt}
                    locale={locale}
                  />
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

      {param && <UserDrawer id={param} onClose={closeDetail} />}
    </div>
  );
}
