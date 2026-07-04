import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserRow } from '../net/rest';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { FeatureToggles } from '../components/FeatureToggles';
import { Drawer } from '../components/Drawer';
import { shortId } from '../lib/fmt';

export function FeaturesView() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.listFeaturedUsers()).users);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="oc-page-title">{t('features.title')}</h1>

      <div className="oc-toolbar">
        <button className="oc-btn primary" onClick={() => setPicking(true)}>
          {t('features.add')}
        </button>
      </div>

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('features.colUser')}</th>
              <th>{t('features.colFeatures')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.displayName} <span className="oc-mono oc-muted">{shortId(u.id)}</span>
                  {u.email && <span className="oc-muted"> · {u.email}</span>}
                </td>
                <td>
                  <span className="oc-muted" style={{ fontSize: 11 }}>
                    {u.features.map((f) => t(`feature.${f}`)).join(' · ')}
                  </span>
                </td>
                <td>
                  <button className="oc-btn" onClick={() => setEditing(u)}>
                    {t('features.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
        )}
      </div>

      {picking && (
        <AccountSelectorModal
          title={t('features.pickTitle')}
          excludeIds={rows.map((u) => u.id)}
          onSelect={(u) => {
            setPicking(false);
            setEditing(u);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && (
        <Drawer
          title={`${t('features.editorTitle')} · ${editing.displayName}`}
          onClose={() => setEditing(null)}
        >
          <section>
            <FeatureToggles
              userId={editing.id}
              initial={editing.features}
              onSaved={() => {
                setEditing(null);
                void load();
              }}
            />
          </section>
        </Drawer>
      )}
    </div>
  );
}
