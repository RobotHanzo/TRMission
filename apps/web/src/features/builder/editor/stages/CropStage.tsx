import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { worldLand, cropToGeography } from '../../geo/world';
import { clientToBoardPoint } from '../canvasProjection';
import { useEditorStore } from '../store';

const WORLD_VIEWBOX = { x: -180, y: -90, w: 360, h: 180 };

interface DragState {
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
}

export function CropStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const setGeography = useEditorStore((s) => s.setGeography);
  const setStage = useEditorStore((s) => s.setStage);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const initialCrop = draft.geography?.crop;
  const [committed, setCommitted] = useState<DragState | null>(
    initialCrop
      ? { lon0: initialCrop.lonMin, lat0: initialCrop.latMax, lon1: initialCrop.lonMax, lat1: initialCrop.latMin }
      : null,
  );

  const active = drag ?? committed;
  const crop = active
    ? {
        lonMin: Math.min(active.lon0, active.lon1),
        lonMax: Math.max(active.lon0, active.lon1),
        latMin: Math.min(active.lat0, active.lat1),
        latMax: Math.max(active.lat0, active.lat1),
      }
    : null;
  const latSpan = crop ? crop.latMax - crop.latMin : 0;
  const result = crop && crop.lonMin < crop.lonMax && crop.latMin < crop.latMax ? cropToGeography(crop) : null;

  const toLonLat = (clientX: number, clientY: number): { lon: number; lat: number } | null => {
    if (!svgRef.current) return null;
    const pt = clientToBoardPoint(svgRef.current, clientX, clientY);
    return pt ? { lon: pt.x, lat: -pt.y } : null;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toLonLat(e.clientX, e.clientY);
    if (!p) return;
    setDragging(true);
    setDrag({ lon0: p.lon, lat0: p.lat, lon1: p.lon, lat1: p.lat });
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const p = toLonLat(e.clientX, e.clientY);
    if (!p || !drag) return;
    setDrag({ ...drag, lon1: p.lon, lat1: p.lat });
  };
  const onPointerUp = () => {
    setDragging(false);
    if (drag) setCommitted(drag);
    setDrag(null);
  };

  const confirm = () => {
    if (!result) return;
    setGeography(result.geography);
    setStage('stops');
  };

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <svg
          ref={svgRef}
          className="board editor-world"
          viewBox={`${WORLD_VIEWBOX.x} ${WORLD_VIEWBOX.y} ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`}
          role="img"
          aria-label={t('builder.cropWorld')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <rect x={-180} y={-90} width={360} height={180} className="editor-world-sea" />
          {worldLand().map((ring, i) => (
            <path
              key={i}
              d={`M ${ring.map(([lon, lat]) => `${lon},${-lat}`).join(' L ')} Z`}
              className="editor-world-land"
            />
          ))}
          {crop && (
            <rect
              x={crop.lonMin}
              y={-crop.latMax}
              width={crop.lonMax - crop.lonMin}
              height={crop.latMax - crop.latMin}
              className="editor-crop-rect"
            />
          )}
        </svg>
        <p className="muted editor-hint">{t('builder.cropHint')}</p>
        {latSpan > 60 && <p className="error">{t('builder.cropLatWarning')}</p>}
      </div>
      <aside className="card stack editor-inspector">
        <h3>{t('builder.cropPreview')}</h3>
        {result ? (
          <>
            <svg
              viewBox={`${result.geography.baseView.x} ${result.geography.baseView.y} ${result.geography.baseView.w} ${result.geography.baseView.h}`}
              className="editor-crop-preview-svg"
              role="img"
              aria-label={t('builder.cropPreview')}
            >
              <rect
                x={result.geography.baseView.x}
                y={result.geography.baseView.y}
                width={result.geography.baseView.w}
                height={result.geography.baseView.h}
                className="editor-world-sea"
              />
              {result.geography.land.map((ring, i) => (
                <path
                  key={i}
                  d={`M ${ring.map(([x, y]) => `${x},${y}`).join(' L ')} Z`}
                  className="editor-world-land"
                />
              ))}
            </svg>
            {result.droppedRings > 0 && (
              <p className="muted">{t('builder.cropDropped', { n: result.droppedRings })}</p>
            )}
            <button className="primary" onClick={confirm}>
              {t('builder.cropConfirm')}
            </button>
          </>
        ) : (
          <p className="muted">{t('builder.cropEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
