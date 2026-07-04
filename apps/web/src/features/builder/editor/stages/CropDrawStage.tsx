import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Crop } from 'lucide-react';
import { worldLand, cropToGeography } from '../../geo/world';
import { clientToBoardPoint } from '../canvasProjection';
import { CanvasControls } from '../CanvasControls';
import { ZoomVar } from '../ZoomVar';
import { useEditorStore } from '../store';

const WORLD_VIEWBOX = { x: -180, y: -90, w: 360, h: 180 };

interface CropRect {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Two arbitrary opposite corners being actively dragged — order-independent; `crop` below
 *  always derives the normalized min/max rect, so which point is "0" vs "1" never matters. */
interface DragPoints {
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: readonly Handle[] = ['nw', 'ne', 'sw', 'se'];

function handleCorner(h: Handle, r: CropRect): { lon: number; lat: number } {
  return {
    lon: h === 'nw' || h === 'sw' ? r.lonMin : r.lonMax,
    lat: h === 'nw' || h === 'ne' ? r.latMax : r.latMin,
  };
}
function oppositeCorner(h: Handle, r: CropRect): { lon: number; lat: number } {
  const opposite: Record<Handle, Handle> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
  return handleCorner(opposite[h], r);
}

export function CropDrawStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const setGeography = useEditorStore((s) => s.setGeography);
  const setStage = useEditorStore((s) => s.setStage);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);

  const initialCrop = draft.geography?.crop;
  const [committed, setCommitted] = useState<CropRect | null>(
    initialCrop
      ? { lonMin: initialCrop.lonMin, lonMax: initialCrop.lonMax, latMin: initialCrop.latMin, latMax: initialCrop.latMax }
      : null,
  );
  const [drag, setDrag] = useState<DragPoints | null>(null);
  const [moveBase, setMoveBase] = useState<{ origin: { lon: number; lat: number }; rect: CropRect } | null>(null);

  const toLonLat = (clientX: number, clientY: number): { lon: number; lat: number } | null => {
    if (!svgRef.current) return null;
    const pt = clientToBoardPoint(svgRef.current, clientX, clientY);
    return pt ? { lon: pt.x, lat: -pt.y } : null;
  };

  // While a corner is being dragged, its live rect always wins; otherwise fall back to committed.
  const liveDragRect: CropRect | null = drag
    ? {
        lonMin: Math.min(drag.lon0, drag.lon1),
        lonMax: Math.max(drag.lon0, drag.lon1),
        latMin: Math.min(drag.lat0, drag.lat1),
        latMax: Math.max(drag.lat0, drag.lat1),
      }
    : null;
  const rect = liveDragRect ?? committed;
  const latSpan = rect ? rect.latMax - rect.latMin : 0;
  const result = rect && rect.lonMin < rect.lonMax && rect.latMin < rect.latMax ? cropToGeography(rect) : null;

  // Left-click is never used for panning here (that's middle-click, see below), so a left-drag
  // starting on open water/land always begins a brand new rectangle — replacing any existing one.
  const startFreehand = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toLonLat(e.clientX, e.clientY);
    if (!p) return;
    setDrag({ lon0: p.lon, lat0: p.lat, lon1: p.lon, lat1: p.lat });
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag) {
      const p = toLonLat(e.clientX, e.clientY);
      if (p) setDrag({ ...drag, lon1: p.lon, lat1: p.lat });
      return;
    }
    if (moveBase) {
      const p = toLonLat(e.clientX, e.clientY);
      if (!p) return;
      const dLon = p.lon - moveBase.origin.lon;
      const dLat = p.lat - moveBase.origin.lat;
      setCommitted({
        lonMin: moveBase.rect.lonMin + dLon,
        lonMax: moveBase.rect.lonMax + dLon,
        latMin: moveBase.rect.latMin + dLat,
        latMax: moveBase.rect.latMax + dLat,
      });
    }
  };
  const onSvgPointerUp = () => {
    if (drag) {
      setCommitted({
        lonMin: Math.min(drag.lon0, drag.lon1),
        lonMax: Math.max(drag.lon0, drag.lon1),
        latMin: Math.min(drag.lat0, drag.lat1),
        latMax: Math.max(drag.lat0, drag.lat1),
      });
      setDrag(null);
    }
    setMoveBase(null);
  };

  const startHandleDrag = (h: Handle) => (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation();
    if (!committed) return;
    const anchor = oppositeCorner(h, committed);
    const moving = handleCorner(h, committed);
    setDrag({ lon0: anchor.lon, lat0: anchor.lat, lon1: moving.lon, lat1: moving.lat });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const startBodyMove = (e: React.PointerEvent<SVGRectElement>) => {
    e.stopPropagation();
    if (!committed) return;
    const p = toLonLat(e.clientX, e.clientY);
    if (!p) return;
    setMoveBase({ origin: p, rect: committed });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startOver = () => {
    setCommitted(null);
    setDrag(null);
    setMoveBase(null);
  };

  const confirm = () => {
    if (!result) return;
    setGeography(result.geography);
    setStage('trim');
  };

  const hint = committed ? t('builder.cropAdjustHint') : t('builder.cropDrawHint');

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <div className="editor-canvas-inner" ref={zoomVarRef}>
          <TransformWrapper
            minScale={1}
            maxScale={64}
            initialScale={1}
            centerOnInit
            wheel={{ step: 0.0022 }}
            doubleClick={{ disabled: true }}
            // Left-click is reserved for drawing/adjusting the crop rectangle (see startFreehand);
            // panning uses the middle mouse button instead, unlike the live board's left-drag pan.
            panning={{ allowLeftClickPan: false, allowMiddleClickPan: true }}
          >
            <ZoomVar targetRef={zoomVarRef} />
            <CanvasControls />
            {/* contentStyle overrides the library's default `width/height: fit-content` on the
                inner content div — without it the SVG's own 100%/100% resolves against an
                indefinite parent and falls back to its tiny intrinsic size, so the world map
                never actually fills (or grows with) the viewport. */}
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <svg
                ref={svgRef}
                className="board editor-world"
                viewBox={`${WORLD_VIEWBOX.x} ${WORLD_VIEWBOX.y} ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`}
                role="img"
                aria-label={t('builder.cropWorld')}
                onPointerDown={startFreehand}
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
              >
                <rect x={-180} y={-90} width={360} height={180} className="editor-world-sea" />
                <g className="editor-world-graticule">
                  {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => (
                    <line key={`gx${lon}`} x1={lon} y1={-90} x2={lon} y2={90} />
                  ))}
                  {[-60, -30, 0, 30, 60].map((lat) => (
                    <line key={`gy${lat}`} x1={-180} y1={-lat} x2={180} y2={-lat} />
                  ))}
                </g>
                {worldLand().map((ring, i) => (
                  <path
                    key={i}
                    d={`M ${ring.map(([lon, lat]) => `${lon},${-lat}`).join(' L ')} Z`}
                    className="editor-world-land"
                  />
                ))}
                {rect && (
                  <g className="editor-crop-group">
                    <rect
                      x={rect.lonMin}
                      y={-rect.latMax}
                      width={rect.lonMax - rect.lonMin}
                      height={rect.latMax - rect.latMin}
                      className="editor-crop-rect"
                      onPointerDown={startBodyMove}
                    />
                    {HANDLES.map((h) => {
                      const c = handleCorner(h, rect);
                      return (
                        <rect
                          key={h}
                          x={c.lon}
                          y={-c.lat}
                          className={`editor-crop-handle editor-crop-handle-${h}`}
                          onPointerDown={startHandleDrag(h)}
                        />
                      );
                    })}
                  </g>
                )}
              </svg>
            </TransformComponent>
          </TransformWrapper>
        </div>
        <p className="muted editor-hint">{hint}</p>
        {latSpan > 60 && <p className="error editor-hint editor-hint--warning">{t('builder.cropLatWarning')}</p>}
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
            <div className="row">
              <button className="primary" onClick={confirm}>
                {t('builder.cropConfirm')}
              </button>
              <button onClick={startOver}>
                <Crop size={14} aria-hidden /> {t('builder.cropRedo')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('builder.cropEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
