import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Eraser, Redo2, Undo2 } from 'lucide-react';
import { CustomGeography } from '../../../../components/Geography';
import { CanvasControls } from '../CanvasControls';
import { ZoomVar } from '../ZoomVar';
import { useEditorStore } from '../store';

/**
 * Fine-tuning pass right after Crop: the crop rectangle is a bounding box, so it always drags in
 * unwanted specks (a neighbouring country's edge, a stray islet). This stage lets the map creator
 * click individual land rings — one per landmass/island, same units `cropToGeography` already
 * produces — to select and delete them, independent of re-drawing the crop box itself.
 */
export function TrimStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const setStage = useEditorStore((s) => s.setStage);
  const removeGeographyRings = useEditorStore((s) => s.removeGeographyRings);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.undoStack.length > 0);
  const canRedo = useEditorStore((s) => s.redoStack.length > 0);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);

  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  // Ctrl/Cmd+Z, Ctrl/Cmd+Y, and Delete — only wired up while this stage is mounted, matching the
  // undo/redo/delete buttons' own scope (see the JSX below, which shows the shortcuts next to them).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack Delete while the user is editing a text field (e.g. the map's name inputs
      // in the header, which stay mounted regardless of stage).
      const target = e.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          undo();
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.key === 'Delete' && selected.size > 0) {
        e.preventDefault();
        removeGeographyRings([...selected]);
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, selected, removeGeographyRings]);

  const geography = draft.geography;
  const view = geography?.baseView ?? { x: 0, y: 0, w: 100, h: 100 };

  const toggleRing = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const deleteSelected = () => {
    removeGeographyRings([...selected]);
    setSelected(new Set());
  };

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <div className="editor-canvas-inner" ref={zoomVarRef}>
          <TransformWrapper minScale={0.5} maxScale={12} initialScale={1} centerOnInit wheel={{ step: 0.0022 }}>
            <ZoomVar targetRef={zoomVarRef} />
            <CanvasControls />
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <svg
                className="board editor-canvas editor-trim"
                viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                role="img"
                aria-label={t('builder.trimWorld')}
                onClick={() => setSelected(new Set())}
              >
                {geography && (
                  <CustomGeography geography={geography} selectedRings={selected} onRingClick={toggleRing} />
                )}
              </svg>
            </TransformComponent>
          </TransformWrapper>
        </div>
        <p className="muted editor-hint">{t('builder.trimHint')}</p>
      </div>
      <aside className="card stack editor-inspector">
        <h3>{t('builder.stageTrim')}</h3>
        <div className="stack trim-history">
          <div className="row">
            <button type="button" onClick={undo} disabled={!canUndo}>
              <Undo2 size={14} aria-hidden /> {t('builder.undo')}
            </button>
            <span className="muted trim-shortcut-hint">Ctrl+Z</span>
          </div>
          <div className="row">
            <button type="button" onClick={redo} disabled={!canRedo}>
              <Redo2 size={14} aria-hidden /> {t('builder.redo')}
            </button>
            <span className="muted trim-shortcut-hint">Ctrl+Y</span>
          </div>
        </div>
        {selected.size > 0 ? (
          <>
            <p className="muted">{t('builder.trimSelectedCount', { n: selected.size })}</p>
            <div className="row">
              <button className="danger" onClick={deleteSelected}>
                <Eraser size={14} aria-hidden /> {t('builder.trimDelete')}
              </button>
              <span className="muted trim-shortcut-hint">Delete</span>
            </div>
          </>
        ) : (
          <p className="muted">{t('builder.trimEmptyHint')}</p>
        )}
        <div className="row">
          <button className="primary" onClick={() => setStage('stops')}>
            {t('builder.trimContinue')}
          </button>
        </div>
      </aside>
    </div>
  );
}
