import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { USER_FEATURES, type UserFeature } from '@trm/shared';
import { api, type UserDetail } from '../net/rest';
import { useToast } from '../store/toast';

/** Checkbox-per-feature editor saving via PUT /dashboard/users/:id/features. */
export function FeatureToggles({
  userId,
  initial,
  onSaved,
}: {
  userId: string;
  initial: UserFeature[];
  onSaved?: (detail: UserDetail) => void;
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
      const detail = await api.putUserFeatures(userId, [...selected]);
      onSaved?.(detail);
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
