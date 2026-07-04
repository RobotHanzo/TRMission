import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { BOW_LIMIT, computeRouteOffsetsFor } from '@trm/map-data';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore } from '../store';

export function CurvesStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const setRouteBow = useEditorStore((s) => s.setRouteBow);
  const clearAllRouteBows = useEditorStore((s) => s.clearAllRouteBows);
  // The in-flight drag/slide value; null while idle. Committed to the store once per gesture so
  // a whole drag is a single undo entry (and a single debounced autosave).
  const [preview, setPreview] = useState<number | null>(null);

  const selectedRoute =
    selection?.kind === 'route' ? draft.routes.find((r) => r.id === selection.id) : undefined;

  // What each route would do with no overrides — the "auto" reference value in the inspector.
  const autoOffsets = useMemo(() => {
    const stripped = draft.routes.map(({ bow: _drop, ...rest }) => rest);
    return computeRouteOffsetsFor(draft.cities, stripped);
  }, [draft.cities, draft.routes]);

  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;
  const tunedCount = draft.routes.filter((r) => r.bow !== undefined).length;
  const autoBow = selectedRoute ? (autoOffsets.get(selectedRoute.id)?.bow ?? 0) : 0;
  const effectiveBow = preview ?? selectedRoute?.bow ?? autoBow;
  const shownBow = Math.round(effectiveBow * 10) / 10;

  const commit = (bow: number): void => {
    setPreview(null);
    if (selectedRoute) setRouteBow(selectedRoute.id, bow);
  };

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          onRouteClick={(id) => {
            setPreview(null);
            select({ kind: 'route', id });
          }}
          onBackgroundClick={() => {
            setPreview(null);
            select(null);
          }}
          {...(selectedRoute
            ? {
                curveHandle: {
                  routeId: selectedRoute.id,
                  bow: preview,
                  onDrag: setPreview,
                  onCommit: commit,
                },
              }
            : {})}
        />
        <p className="muted editor-hint">{t('builder.curvesHint')}</p>
      </div>
      <aside className="card stack editor-inspector">
        {selectedRoute ? (
          <>
            <h3>{t('builder.editCurve', { a: cityName(selectedRoute.a), b: cityName(selectedRoute.b) })}</h3>
            <label className="field">
              <span className="field-label">{t('builder.curveBow')}</span>
              <input
                type="range"
                min={-BOW_LIMIT}
                max={BOW_LIMIT}
                step={0.1}
                value={shownBow}
                onChange={(e) => setPreview(Number(e.target.value))}
                onPointerUp={() => {
                  if (preview !== null) commit(preview);
                }}
                onBlur={() => {
                  if (preview !== null) commit(preview);
                }}
                aria-label={t('builder.curveBow')}
              />
            </label>
            <label className="field">
              <input
                type="number"
                min={-BOW_LIMIT}
                max={BOW_LIMIT}
                step={0.1}
                value={shownBow}
                onChange={(e) => setPreview(Number(e.target.value) || 0)}
                onBlur={() => {
                  if (preview !== null) commit(preview);
                }}
                aria-label={t('builder.curveBow')}
              />
            </label>
            <p className="muted">{t('builder.curveAuto', { value: autoBow.toFixed(1) })}</p>
            <button
              onClick={() => {
                setPreview(null);
                setRouteBow(selectedRoute.id, undefined);
              }}
              disabled={selectedRoute.bow === undefined}
            >
              <RotateCcw size={14} aria-hidden /> {t('builder.curveReset')}
            </button>
          </>
        ) : (
          <>
            <p className="muted">{t('builder.curvesEmptyHint')}</p>
            {tunedCount > 0 && (
              <button onClick={clearAllRouteBows}>
                <RotateCcw size={14} aria-hidden /> {t('builder.curveResetAll', { n: tunedCount })}
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
