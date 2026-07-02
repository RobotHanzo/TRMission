import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Switch } from '../../../../components/ui/Switch';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore } from '../store';

let nextCityCounter = 0;
const newCityId = (): string => `c${Date.now().toString(36)}${(nextCityCounter++).toString(36)}`;

export function StopsStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const placeCity = useEditorStore((s) => s.placeCity);
  const updateCity = useEditorStore((s) => s.updateCity);
  const removeCity = useEditorStore((s) => s.removeCity);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected =
    selection?.kind === 'city' ? draft.cities.find((c) => c.id === selection.id) : undefined;

  const incidentRoutes = selected
    ? draft.routes.filter((r) => r.a === selected.id || r.b === selected.id).length
    : 0;
  const incidentTickets = selected
    ? draft.tickets.filter((tk) => tk.a === selected.id || tk.b === selected.id).length
    : 0;

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          onBackgroundClick={(pt) => {
            const id = newCityId();
            placeCity({
              id,
              // A default content name in both languages, independent of the builder UI's
              // current locale — the user renames it via the inspector immediately after.
              nameZh: '新車站',
              nameEn: 'New Stop',
              x: Math.round(pt.x * 10) / 10,
              y: Math.round(pt.y * 10) / 10,
              region: '',
              isIsland: false,
            });
            select({ kind: 'city', id });
          }}
          onCityClick={(id) => select({ kind: 'city', id })}
        />
        <p className="muted editor-hint">{t('builder.stopsHint')}</p>
      </div>
      <aside className="card stack editor-inspector">
        {selected ? (
          <>
            <h3>{t('builder.editStop')}</h3>
            <label className="field">
              <span className="field-label">{t('builder.nameZh')}</span>
              <input
                value={selected.nameZh}
                onChange={(e) => updateCity(selected.id, { nameZh: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('builder.nameEn')}</span>
              <input
                value={selected.nameEn}
                onChange={(e) => updateCity(selected.id, { nameEn: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('builder.region')}</span>
              <input
                value={selected.region}
                onChange={(e) => updateCity(selected.id, { region: e.target.value })}
              />
            </label>
            <div className="row between setting-row">
              <span className="field-label">{t('builder.isIsland')}</span>
              <Switch
                checked={selected.isIsland}
                onChange={(v) => updateCity(selected.id, { isIsland: v })}
                label={t('builder.isIsland')}
              />
            </div>
            {confirmDelete ? (
              <div className="stack">
                <p className="muted">
                  {t('builder.confirmDeleteStop', {
                    routes: incidentRoutes,
                    tickets: incidentTickets,
                  })}
                </p>
                <div className="row">
                  <button
                    className="danger"
                    onClick={() => {
                      removeCity(selected.id);
                      setConfirmDelete(false);
                    }}
                  >
                    {t('builder.confirmDelete')}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}>{t('cancel')}</button>
                </div>
              </div>
            ) : (
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} aria-hidden /> {t('builder.deleteStop')}
              </button>
            )}
          </>
        ) : (
          <p className="muted">{t('builder.stopsEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
