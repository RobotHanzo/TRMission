import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type TrainCarSkinRow } from '../net/rest';
import { useUi } from '../store/ui';
import { useToast } from '../store/toast';

/** Checkbox-per-pack editor for which train-card skins players may pick in settings, saved via
 *  PUT /dashboard/config/train-car-skins. The default pack arrives `locked` — it is the fallback
 *  every disabled selection resolves back to, so the server keeps it on regardless and its
 *  checkbox is disabled here rather than being offered and then quietly ignored. */
export function TrainCarSkinToggles({
  initial,
  onSaved,
}: {
  initial: TrainCarSkinRow[];
  onSaved?: (skins: TrainCarSkinRow[]) => void;
}) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const pushToast = useToast((s) => s.push);
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(initial.filter((s) => s.enabled).map((s) => s.skinId)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (skinId: string) =>
    setEnabled((s) => {
      const next = new Set(s);
      if (next.has(skinId)) next.delete(skinId);
      else next.add(skinId);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { skins } = await api.putTrainCarSkins([...enabled]);
      setEnabled(new Set(skins.filter((s) => s.enabled).map((s) => s.skinId)));
      onSaved?.(skins);
      pushToast('success', t('toast.trainCarSkinsSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {initial.map((s) => {
        const name = locale === 'en' ? s.nameEn : s.nameZh;
        return (
          <label
            key={s.skinId}
            className="oc-kv"
            style={{ cursor: s.locked ? 'default' : 'pointer' }}
          >
            <span className="k">
              {name}
              {s.locked ? ` · ${t('features.skinsDefault')}` : ''}
            </span>
            <input
              type="checkbox"
              checked={s.locked || enabled.has(s.skinId)}
              disabled={s.locked}
              onChange={() => toggle(s.skinId)}
              aria-label={name}
            />
          </label>
        );
      })}
      {error && <p style={{ color: 'var(--oc-signal-stop)' }}>{error}</p>}
      <button className="oc-btn primary" disabled={busy} onClick={() => void save()}>
        {t('features.save')}
      </button>
    </>
  );
}
