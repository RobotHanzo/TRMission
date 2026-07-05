import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DASHBOARD_PERMISSIONS,
  DASHBOARD_ROLES,
  type DashboardPermission,
  type DashboardRole,
} from '@trm/shared';
import { api, type MaintainerRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Drawer } from '../components/Drawer';
import { useToast } from '../store/toast';
import { fmtDateTime, shortId } from '../lib/fmt';

const ROLE_KEY: Record<DashboardRole, string> = {
  owner: 'maintainers.roleOwner',
  admin: 'maintainers.roleAdmin',
  moderator: 'maintainers.roleModerator',
  viewer: 'maintainers.roleViewer',
};

function Editor({
  row,
  onSaved,
  onClose,
}: {
  row: { userId: string; displayName?: string } & Partial<MaintainerRow>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<DashboardRole>(row.role ?? 'viewer');
  const [extra, setExtra] = useState<Set<DashboardPermission>>(new Set(row.extraPermissions ?? []));
  const [denied, setDenied] = useState<Set<DashboardPermission>>(
    new Set(row.deniedPermissions ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToast((s) => s.push);

  const toggle = (set: Set<DashboardPermission>, p: DashboardPermission) => {
    const next = new Set(set);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    return next;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.putMaintainer(row.userId, {
        role,
        ...(extra.size ? { extraPermissions: [...extra] } : {}),
        ...(denied.size ? { deniedPermissions: [...denied] } : {}),
      });
      pushToast('success', t('toast.maintainerSaved'));
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={`${t('maintainers.editorTitle')} · ${row.displayName ?? shortId(row.userId)}`}
      onClose={onClose}
    >
      <section>
        <h3>{t('maintainers.colRole')}</h3>
        <div className="oc-tabs" role="radiogroup">
          {DASHBOARD_ROLES.map((r) => (
            <button
              key={r}
              className={role === r ? 'active' : ''}
              onClick={() => setRole(r)}
              role="radio"
              aria-checked={role === r}
            >
              {t(ROLE_KEY[r])}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3>{t('maintainers.extra')}</h3>
        {DASHBOARD_PERMISSIONS.map((p) => (
          <label key={p} className="oc-kv" style={{ cursor: 'pointer' }}>
            <span className="k">{t(`perm.${p}`)}</span>
            <input
              type="checkbox"
              checked={extra.has(p)}
              onChange={() => setExtra((s) => toggle(s, p))}
            />
          </label>
        ))}
      </section>
      <section>
        <h3>{t('maintainers.denied')}</h3>
        {DASHBOARD_PERMISSIONS.map((p) => (
          <label key={p} className="oc-kv" style={{ cursor: 'pointer' }}>
            <span className="k">{t(`perm.${p}`)}</span>
            <input
              type="checkbox"
              checked={denied.has(p)}
              onChange={() => setDenied((s) => toggle(s, p))}
            />
          </label>
        ))}
      </section>
      {error && <p style={{ color: 'var(--oc-signal-stop)' }}>{error}</p>}
      <button className="oc-btn primary" disabled={busy} onClick={() => void save()}>
        {t('maintainers.save')}
      </button>
    </Drawer>
  );
}

export function MaintainersView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canWrite = useSession((s) => s.hasPermission('maintainers.write'));
  const selfId = useSession((s) => s.user?.id);
  const pushToast = useToast((s) => s.push);

  const [rows, setRows] = useState<MaintainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<
    ({ userId: string; displayName?: string } & Partial<MaintainerRow>) | null
  >(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.listMaintainers()).maintainers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (userId: string) => {
    setBusy(true);
    try {
      await api.deleteMaintainer(userId);
      await load();
      pushToast('success', t('toast.maintainerRevoked'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };

  return (
    <div>
      <h1 className="oc-page-title">{t('maintainers.title')}</h1>

      {canWrite && (
        <div className="oc-toolbar">
          <button className="oc-btn primary" onClick={() => setPicking(true)}>
            {t('maintainers.add')}
          </button>
        </div>
      )}

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('maintainers.colUser')}</th>
              <th>{t('maintainers.colRole')}</th>
              <th>{t('maintainers.colPermissions')}</th>
              <th>{t('maintainers.colGranted')}</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isSelf = m.userId === selfId;
              return (
                <tr key={m.userId}>
                  <td>
                    {m.displayName ?? <span className="oc-muted">{t('maintainers.dangling')}</span>}{' '}
                    <span className="oc-mono oc-muted">{shortId(m.userId)}</span>
                  </td>
                  <td>
                    <span className="oc-role-badge">{t(ROLE_KEY[m.role])}</span>
                  </td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 380 }}>
                    <span className="oc-muted" style={{ fontSize: 11 }}>
                      {m.permissions.map((p) => t(`perm.${p}`)).join(' · ')}
                    </span>
                  </td>
                  <td className="num">{fmtDateTime(m.grantedAt, locale)}</td>
                  {canWrite && (
                    <td>
                      {isSelf ? (
                        <span className="oc-muted" style={{ fontSize: 11 }}>
                          {t('maintainers.selfHint')}
                        </span>
                      ) : (
                        <>
                          <button className="oc-btn" onClick={() => setEditing(m)}>
                            {t('maintainers.edit')}
                          </button>{' '}
                          <button className="oc-btn danger" onClick={() => setRevoking(m.userId)}>
                            {t('maintainers.revoke')}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
        )}
      </div>

      {picking && (
        <AccountSelectorModal
          title={t('maintainers.addTitle')}
          excludeIds={rows.map((m) => m.userId)}
          onSelect={(u) => {
            setPicking(false);
            setEditing({ userId: u.id, displayName: u.displayName });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && (
        <Editor row={editing} onSaved={() => void load()} onClose={() => setEditing(null)} />
      )}
      {revoking && (
        <ConfirmDialog
          title={t('maintainers.revokeConfirmTitle')}
          body={t('maintainers.revokeConfirmBody')}
          confirmLabel={t('maintainers.revoke')}
          danger
          busy={busy}
          onConfirm={() => void revoke(revoking)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
