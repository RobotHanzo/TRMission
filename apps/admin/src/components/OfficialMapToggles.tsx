import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type OfficialMapRow } from '../net/rest';
import { useUi } from '../store/ui';
import { useToast } from '../store/toast';

/** Checkbox-per-map editor for which official maps players may pick, saved via
 *  PUT /dashboard/config/official-maps. The server keeps at least one map enabled — a save that
 *  would switch the last one off comes back 400 and is shown inline. */
export function OfficialMapToggles({
  initial,
  onSaved,
}: {
  initial: OfficialMapRow[];
  onSaved?: (maps: OfficialMapRow[]) => void;
}) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const pushToast = useToast((s) => s.push);
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(initial.filter((m) => m.enabled).map((m) => m.mapId)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (mapId: string) =>
    setEnabled((s) => {
      const next = new Set(s);
      if (next.has(mapId)) next.delete(mapId);
      else next.add(mapId);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { maps } = await api.putOfficialMaps([...enabled]);
      setEnabled(new Set(maps.filter((m) => m.enabled).map((m) => m.mapId)));
      onSaved?.(maps);
      pushToast('success', t('toast.officialMapsSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {initial.map((m) => (
        <label key={m.mapId} className="oc-kv" style={{ cursor: 'pointer' }}>
          <span className="k">
            {locale === 'en' ? m.nameEn : m.nameZh}
            {m.author !== undefined ? `（${m.author}）` : ''}
          </span>
          <input
            type="checkbox"
            checked={enabled.has(m.mapId)}
            onChange={() => toggle(m.mapId)}
            aria-label={locale === 'en' ? m.nameEn : m.nameZh}
          />
        </label>
      ))}
      {error && <p style={{ color: 'var(--oc-signal-stop)' }}>{error}</p>}
      <button className="oc-btn primary" disabled={busy} onClick={() => void save()}>
        {t('features.save')}
      </button>
    </>
  );
}
