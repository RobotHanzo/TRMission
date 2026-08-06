import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserFeature } from '@trm/shared';
import { api, type OfficialMapRow, type TrainCarSkinRow, type UserRow } from '../net/rest';
import { useSession } from '../store/session';
import { AccountSelectorModal } from '../components/AccountSelectorModal';
import { FeatureToggles } from '../components/FeatureToggles';
import { OfficialMapToggles } from '../components/OfficialMapToggles';
import { TrainCarSkinToggles } from '../components/TrainCarSkinToggles';
import { Drawer } from '../components/Drawer';
import { Copyable } from '../components/CopyButton';
import { shortId } from '../lib/fmt';

export function FeaturesView() {
  const { t } = useTranslation();
  const canEditDefaults = useSession((s) => s.hasPermission('config.features'));
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [defaults, setDefaults] = useState<UserFeature[] | null>(null);
  const [officialMaps, setOfficialMaps] = useState<OfficialMapRow[] | null>(null);
  const [skins, setSkins] = useState<TrainCarSkinRow[] | null>(null);

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

  useEffect(() => {
    if (!canEditDefaults) return;
    void api.getDefaultFeatures().then((r) => setDefaults(r.features));
    void api.getOfficialMaps().then((r) => setOfficialMaps(r.maps));
    void api.getTrainCarSkins().then((r) => setSkins(r.skins));
  }, [canEditDefaults]);

  return (
    <div>
      <h1 className="oc-page-title">{t('features.title')}</h1>

      {canEditDefaults && defaults && (
        <section>
          <h2>{t('features.defaultsTitle')}</h2>
          <p className="oc-muted">{t('features.defaultsDesc')}</p>
          <FeatureToggles target={{ kind: 'defaults', onSaved: setDefaults }} initial={defaults} />
        </section>
      )}

      {canEditDefaults && officialMaps && (
        <section>
          <h2>{t('features.mapsTitle')}</h2>
          <p className="oc-muted">{t('features.mapsDesc')}</p>
          <OfficialMapToggles initial={officialMaps} onSaved={setOfficialMaps} />
        </section>
      )}

      {canEditDefaults && skins && (
        <section>
          <h2>{t('features.skinsTitle')}</h2>
          <p className="oc-muted">{t('features.skinsDesc')}</p>
          <TrainCarSkinToggles initial={skins} onSaved={setSkins} />
        </section>
      )}

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
                  {u.displayName} <Copyable value={u.id} display={shortId(u.id)} label="ID" muted />
                  {u.email && (
                    <>
                      {' · '}
                      <Copyable value={u.email} label={t('users.colEmail')} mono={false} muted />
                    </>
                  )}
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
            <div className="oc-kv">
              <span className="k">ID</span>
              <span className="v">
                <Copyable value={editing.id} label="ID" />
              </span>
            </div>
            {editing.email && (
              <div className="oc-kv">
                <span className="k">{t('users.colEmail')}</span>
                <span className="v">
                  <Copyable value={editing.email} label={t('users.colEmail')} />
                </span>
              </div>
            )}
          </section>
          <section>
            <FeatureToggles
              target={{
                kind: 'user',
                userId: editing.id,
                onSaved: () => {
                  setEditing(null);
                  void load();
                },
              }}
              initial={editing.features}
            />
          </section>
        </Drawer>
      )}
    </div>
  );
}
