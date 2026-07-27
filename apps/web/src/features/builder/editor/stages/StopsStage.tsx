import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, Move, Trash2, X } from 'lucide-react';
import { Segmented } from '../../../../components/ui/Segmented';
import { Switch } from '../../../../components/ui/Switch';
import { EditorCanvas, type ClickModifiers } from '../EditorCanvas';
import { selectionBounds } from '../selectionBounds';
import { useEditorStore } from '../store';

let nextCityCounter = 0;
const newCityId = (): string => `c${Date.now().toString(36)}${(nextCityCounter++).toString(36)}`;

/** Board units an arrow key nudges the selection by; Shift takes the coarser step. */
const NUDGE = 0.5;
const NUDGE_FAST = 2;
const ARROW_DELTA: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

/**
 * Placing and arranging stations. One station is the usual case — click it, edit it in the
 * inspector — but laying out a region often means shifting a whole cluster without disturbing the
 * spacing inside it, so a selection here can hold any number of stations: shift/ctrl-click (or the
 * multi-select switch, which is the touch path) adds and removes them, "select all" takes the lot.
 * Whatever is selected moves as one — by drag, by arrow key, or by the move button's click-to-place
 * — always keeping its internal geometry and always as a single undo step.
 */
export function StopsStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const select = useEditorStore((s) => s.select);
  const placeCity = useEditorStore((s) => s.placeCity);
  const updateCity = useEditorStore((s) => s.updateCity);
  const removeCity = useEditorStore((s) => s.removeCity);
  const moveCities = useEditorStore((s) => s.moveCities);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [multiSelect, setMultiSelect] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  // The store's single `selection` stays the one-station case, so the inspector, the ember ring
  // and every other stage keep working exactly as before; a group of two or more lives here and
  // leaves the store selection empty.
  const applySelection = useCallback(
    (ids: ReadonlySet<string>) => {
      setSelectedIds(ids);
      const [only] = ids.size === 1 ? [...ids] : [];
      select(only ? { kind: 'city', id: only } : null);
    },
    [select],
  );

  const cities = draft.cities;
  const selectedCities = useMemo(
    () => cities.filter((c) => selectedIds.has(c.id)),
    [cities, selectedIds],
  );
  const selected = selectedCities.length === 1 ? selectedCities[0] : undefined;
  const count = selectedCities.length;

  // A station that no longer exists (deleted, or dropped by an undo) can't stay selected.
  useEffect(() => {
    if (selectedIds.size === selectedCities.length) return;
    applySelection(new Set(selectedCities.map((c) => c.id)));
  }, [selectedCities, selectedIds, applySelection]);

  // Changing WHAT is selected always cancels an in-flight move — the move was aimed at the old
  // selection, and silently re-aiming it at the new one is never what was meant.
  const selectionKey = [...selectedIds].sort().join(',');
  useEffect(() => {
    setIsMoving(false);
    setConfirmDelete(false);
  }, [selectionKey]);

  const nudge = useCallback(
    (dx: number, dy: number) => moveCities([...selectedIds], dx, dy),
    [moveCities, selectedIds],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (cities.length === 0) return;
        e.preventDefault();
        applySelection(new Set(cities.map((c) => c.id)));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (isMoving) setIsMoving(false);
        else if (selectedIds.size > 0) applySelection(new Set());
        return;
      }
      const dir = ARROW_DELTA[e.key];
      if (dir && selectedIds.size > 0) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_FAST : NUDGE;
        nudge(dir.dx * step, dir.dy * step);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMoving, selectedIds, cities, applySelection, nudge]);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    applySelection(next);
  };

  const onCityClick = (id: string, mods?: ClickModifiers) => {
    const additive = multiSelect || !!(mods?.shiftKey || mods?.ctrlKey || mods?.metaKey);
    if (additive) toggle(id);
    else applySelection(new Set([id]));
  };

  const onBackgroundClick = (pt: { x: number; y: number }) => {
    const x = Math.round(pt.x * 10) / 10;
    const y = Math.round(pt.y * 10) / 10;
    if (isMoving && count > 0) {
      // The frame's centre is the group's handle: it lands on the click, everything else keeps
      // its offset from it. For a single station that is just "put it here".
      const anchor = selectionBounds(selectedCities)!;
      moveCities([...selectedIds], x - anchor.cx, y - anchor.cy);
      setIsMoving(false);
      return;
    }
    // While multi-select is on, the empty canvas is for clearing the selection, not for dropping
    // a station the user didn't mean to place mid-selection.
    if (multiSelect) {
      if (selectedIds.size > 0) applySelection(new Set());
      return;
    }
    const id = newCityId();
    placeCity({
      id,
      // A default content name in both languages, independent of the builder UI's
      // current locale — the user renames it via the inspector immediately after.
      nameZh: '新車站',
      nameEn: 'New Stop',
      x,
      y,
      region: '',
      isIsland: false,
    });
    applySelection(new Set([id]));
  };

  const incidentRoutes = selected
    ? draft.routes.filter((r) => r.a === selected.id || r.b === selected.id).length
    : 0;
  const incidentTickets = selected
    ? draft.tickets.filter((tk) => tk.a === selected.id || tk.b === selected.id).length
    : 0;

  const hint = isMoving
    ? selected
      ? t('builder.moveStopHint', { name: selected.nameZh })
      : t('builder.moveSelectedHint', { n: count })
    : multiSelect
      ? t('builder.stopsMultiHint')
      : t('builder.stopsHint');

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          selectedCities={selectedIds}
          cityDrag={{
            begin: (id, mods) => {
              // Shift/ctrl-click and multi-select mode are for changing the selection, so they
              // never start a drag — the click that follows does the toggling.
              if (multiSelect || mods.shiftKey || mods.ctrlKey || mods.metaKey) return null;
              if (selectedIds.has(id)) return selectedIds;
              // Dragging a station outside the selection takes it as the new selection first,
              // rather than dragging something the map doesn't show as picked.
              const only = new Set([id]);
              applySelection(only);
              return only;
            },
            commit: (ids, dx, dy) => moveCities([...ids], dx, dy),
          }}
          onBackgroundClick={onBackgroundClick}
          onCityClick={onCityClick}
        />
        <p className="muted editor-hint">{hint}</p>
      </div>
      <aside className="card stack editor-inspector">
        <div className="stack editor-select-bar">
          <div className="row between">
            <span className="field-label">{t('builder.selection')}</span>
            <span
              className={
                count === 0
                  ? 'editor-select-count editor-select-count--empty'
                  : 'editor-select-count'
              }
              role="status"
            >
              {count}
              <span className="muted"> / {cities.length}</span>
            </span>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => applySelection(new Set(cities.map((c) => c.id)))}
              disabled={cities.length === 0 || count === cities.length}
            >
              <CheckCheck size={14} aria-hidden /> {t('builder.selectAll')}
            </button>
            <button type="button" onClick={() => applySelection(new Set())} disabled={count === 0}>
              <X size={14} aria-hidden /> {t('builder.clearSelection')}
            </button>
          </div>
          <div className="row between setting-row">
            <span className="field-label">{t('builder.multiSelect')}</span>
            <Switch
              checked={multiSelect}
              onChange={setMultiSelect}
              label={t('builder.multiSelect')}
            />
          </div>
          <p className="muted editor-select-tip">{t('builder.selectHint')}</p>
        </div>

        {count > 1 ? (
          <>
            <h3>{t('builder.selectedStops', { n: count })}</h3>
            <button type="button" onClick={() => setIsMoving((v) => !v)}>
              <Move size={14} aria-hidden />{' '}
              {isMoving ? t('builder.cancelMove') : t('builder.moveSelected')}
            </button>
            <p className="muted editor-select-tip">{t('builder.moveTip')}</p>
          </>
        ) : selected ? (
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
            <div className="field">
              <span className="field-label">{t('builder.stationPriority')}</span>
              <Segmented<string>
                options={[
                  { value: 'major', label: t('builder.tierMajor') },
                  { value: 'secondary', label: t('builder.tierSecondary') },
                  { value: 'tertiary', label: t('builder.tierTertiary') },
                  { value: 'minor', label: t('builder.tierMinor') },
                ]}
                value={selected.tier ?? 'minor'}
                onChange={(v) => updateCity(selected.id, { tier: v })}
                ariaLabel={t('builder.stationPriority')}
              />
            </div>
            <button type="button" onClick={() => setIsMoving((v) => !v)}>
              <Move size={14} aria-hidden />{' '}
              {isMoving ? t('builder.cancelMove') : t('builder.moveStop')}
            </button>
            <p className="muted editor-select-tip">{t('builder.moveTip')}</p>
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
                      applySelection(new Set());
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
