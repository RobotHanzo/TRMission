import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { BOW_LIMIT } from '@trm/map-data';
import { MapScene } from '../../../components/MapScene';
import { buildRouteGeometryFor } from '../../../game/routeGeometry';
import type { RouteDraft } from '../../../net/rest';
import { clientToBoardPoint } from './canvasProjection';
import { bowFromPoint } from './curveMath';
import { CanvasControls } from './CanvasControls';
import { ZoomVar } from './ZoomVar';
import { useEditorStore } from './store';
import '../../../styles/game.css';

const DEFAULT_VIEW = { x: 0, y: 0, w: 100, h: 100 };

export interface CurveHandle {
  routeId: string;
  /** Live preview value while dragging/sliding; null when idle (render the stored/auto bow). */
  bow: number | null;
  onDrag(bow: number): void;
  onCommit(bow: number): void;
}

export interface EditorCanvasProps {
  /** Empty-canvas / land click, in board units — placing a new city, or a no-op if the stage
   *  doesn't handle placement (e.g. the Missions stage never renders this canvas at all). */
  onBackgroundClick?: (point: { x: number; y: number }) => void;
  onCityClick?: (id: string) => void;
  onRouteClick?: (id: string) => void;
  /** City ids to visually highlight (e.g. the two endpoints picked mid-route-creation). */
  highlightCities?: ReadonlySet<string>;
  /** Curves-stage apex handle: rendered for this route, draggable along the chord normal. */
  curveHandle?: CurveHandle;
}

/**
 * The shared SVG workspace for the Stops/Routes/Curves stages: pan/zoom (matching the live
 * board's feel) around the SAME MapScene the live board renders — the editor variation is
 * nothing but props (draft content, selection/highlight classes, always-on hit paths, zh
 * labels) plus the curve-apex handle as an overlay child — so an authored map previews
 * exactly as it will play, independent of the live-game rendering singleton (game/catalog.ts).
 */
export function EditorCanvas({
  onBackgroundClick,
  onCityClick,
  onRouteClick,
  highlightCities,
  curveHandle,
}: EditorCanvasProps) {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);
  const view = draft.geography?.baseView ?? DEFAULT_VIEW;

  const routesForGeometry = useMemo(() => {
    if (!curveHandle || curveHandle.bow === null) return draft.routes;
    const target = draft.routes.find((r) => r.id === curveHandle.routeId);
    if (!target) return draft.routes;
    const inPair = (r: RouteDraft): boolean =>
      r.id === target.id || (!!target.doubleGroup && r.doubleGroup === target.doubleGroup);
    // Ephemeral drag/slide preview: the pair bows together, exactly as setRouteBow will commit.
    return draft.routes.map((r) => (inPair(r) ? { ...r, bow: curveHandle.bow! } : r));
  }, [draft.routes, curveHandle]);

  const { geometry, hubs } = useMemo(
    () => buildRouteGeometryFor(draft.cities, routesForGeometry),
    [draft.cities, routesForGeometry],
  );

  const onHandlePointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!curveHandle || !svgRef.current) return;
    const route = draft.routes.find((r) => r.id === curveHandle.routeId);
    const a = route && draft.cities.find((c) => c.id === route.a);
    const b = route && draft.cities.find((c) => c.id === route.b);
    if (!route || !a || !b) return;
    e.stopPropagation();
    e.preventDefault();
    const svg = svgRef.current;
    let last = curveHandle.bow ?? bowFromPoint(a, b, geometry.get(route.id)?.mid ?? a);
    const move = (ev: PointerEvent) => {
      const p = clientToBoardPoint(svg, ev.clientX, ev.clientY);
      if (!p) return;
      last = Math.max(-BOW_LIMIT, Math.min(BOW_LIMIT, bowFromPoint(a, b, p)));
      curveHandle.onDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      curveHandle.onCommit(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handleBackgroundClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onBackgroundClick || !svgRef.current) return;
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('land')) return;
    const pt = clientToBoardPoint(svgRef.current, e.clientX, e.clientY);
    if (pt) onBackgroundClick(pt);
  };

  return (
    <div className="editor-canvas-inner" ref={zoomVarRef}>
      <TransformWrapper
        minScale={0.5}
        maxScale={12}
        initialScale={1}
        centerOnInit
        wheel={{ step: 0.0022 }}
        panning={{ excluded: ['curve-handle'] }}
      >
        <ZoomVar targetRef={zoomVarRef} />
        <CanvasControls />
        {/* contentStyle overrides the library's default `width/height: fit-content` on the inner
            content div — without it the SVG's own 100%/100% resolves against an indefinite parent
            and falls back to its tiny intrinsic size instead of filling (and tracking) the viewport. */}
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <MapScene
            svgRef={svgRef}
            className="editor-canvas"
            cities={draft.cities}
            routes={draft.routes}
            geometry={geometry}
            hubs={hubs}
            geography={draft.geography ?? null}
            view={view}
            ariaLabel={t('builder.canvasLabel')}
            onSvgClick={handleBackgroundClick}
            alwaysHitRoutes
            cityHitArea="group"
            cityLabel={(c) => c.nameZh}
            routeClass={(r) =>
              'editor-route' +
              (selection?.kind === 'route' && selection.id === r.id
                ? ' editor-route--selected'
                : '')
            }
            cityClass={(c) =>
              'editor-city' +
              (selection?.kind === 'city' && selection.id === c.id
                ? ' editor-city--selected'
                : '') +
              (highlightCities?.has(c.id) ? ' editor-city--highlighted' : '')
            }
            onRouteClick={onRouteClick}
            onCityClick={onCityClick}
          >
            {curveHandle && geometry.get(curveHandle.routeId) && (
              <circle
                className="curve-handle"
                cx={geometry.get(curveHandle.routeId)!.mid.x}
                cy={geometry.get(curveHandle.routeId)!.mid.y}
                onPointerDown={onHandlePointerDown}
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </MapScene>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
