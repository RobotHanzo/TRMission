import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { USER_FEATURES, type UserFeature } from '@trm/shared';
import { api, type UserDetail } from '../net/rest';
import { useToast } from '../store/toast';

export type FeatureToggleTarget =
  | { kind: 'user'; userId: string; onSaved?: (detail: UserDetail) => void }
  | { kind: 'defaults'; onSaved?: (features: UserFeature[]) => void };

/** Checkbox-per-feature editor. Saves via PUT /dashboard/users/:id/features for a `user`
 *  target, or PUT /dashboard/config/features for the `defaults` target. */
export function FeatureToggles({
  target,
  initial,
}: {
  target: FeatureToggleTarget;
  initial: UserFeature[];
}) {
  const { t } = useTranslation();
  const pushToast = useToast((s) => s.push);
  const [selected, setSelected] = useState<Set<UserFeature>>(new Set(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (f: UserFeature) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'user') {
        const detail = await api.putUserFeatures(target.userId, [...selected]);
        target.onSaved?.(detail);
      } else {
        const { features } = await api.putDefaultFeatures([...selected]);
        target.onSaved?.(features);
      }
      pushToast('success', t('toast.featuresSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {USER_FEATURES.map((f) => (
        <label key={f} className="oc-kv" style={{ cursor: 'pointer' }}>
          <span className="k">{t(`feature.${f}`)}</span>
          <input type="checkbox" checked={selected.has(f)} onChange={() => toggle(f)} />
        </label>
      ))}
      {error && <p style={{ color: 'var(--oc-signal-stop)' }}>{error}</p>}
      <button className="oc-btn primary" disabled={busy} onClick={() => void save()}>
        {t('features.save')}
      </button>
    </>
  );
}
