import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { BOW_LIMIT } from '@trm/map-data';
import { MapScene } from '../../../components/MapScene';
import { buildRouteGeometryFor } from '../../../game/routeGeometry';
import { frameHome } from '../../../game/frameHome';
import type { RouteDraft } from '../../../net/rest';
import { clientToBoardPoint } from './canvasProjection';
import { bowFromPoint } from './curveMath';
import { selectionBounds } from './selectionBounds';
import { CanvasControls } from './CanvasControls';
import { ZoomVar } from './ZoomVar';
import { useEditorStore } from './store';
import '../../../styles/game.css';

const DEFAULT_VIEW = { x: 0, y: 0, w: 100, h: 100 };
/** Board units of air between the outermost selected stations and the dashed frame. */
const FRAME_PAD = 1.8;
/** Half-length of the frame's centre crosshair arms, in board units. */
const ANCHOR_ARM = 1.1;
/** Client-space slop before a press on a station counts as a drag rather than a click — small
 *  enough to feel immediate, large enough that a click never nudges the map. */
const DRAG_SLOP_PX = 3;

export interface CurveHandle {
  routeId: string;
  /** Live preview value while dragging/sliding; null when idle (render the stored/auto bow). */
  bow: number | null;
  onDrag(bow: number): void;
  onCommit(bow: number): void;
}

/** Modifier state a city click carries, so a stage can tell "select this one" from "add this one
 *  to what's already selected". */
export interface ClickModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface CityDrag {
  /** Pointer-down on a station: return the ids that should travel with it, or null to leave the
   *  gesture alone (the canvas then pans / the click selects as usual). */
  begin(id: string, mods: ClickModifiers): ReadonlySet<string> | null;
  /** Pointer-up after a real drag — the whole translation, to commit as one undo step. */
  commit(ids: ReadonlySet<string>, dx: number, dy: number): void;
}

export interface EditorCanvasProps {
  /** Empty-canvas / land click, in board units — placing a new city, or a no-op if the stage
   *  doesn't handle placement (e.g. the Missions stage never renders this canvas at all). */
  onBackgroundClick?: (point: { x: number; y: number }) => void;
  onCityClick?: (id: string, mods?: ClickModifiers) => void;
  onRouteClick?: (id: string) => void;
  /** City ids to visually highlight (e.g. the two endpoints picked mid-route-creation). */
  highlightCities?: ReadonlySet<string>;
  /** City ids drawn as selected. Two or more also raise the dashed selection frame and its
   *  centre anchor — the group the Stops stage moves as one. */
  selectedCities?: ReadonlySet<string>;
  /** Drag-to-move for the selected stations (Stops stage). Supplying it also takes station
   *  markers out of the canvas's pan gesture, so a press on one always grabs the station. */
  cityDrag?: CityDrag;
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
  selectedCities,
  cityDrag,
  curveHandle,
}: EditorCanvasProps) {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);
  const view = draft.geography?.baseView ?? DEFAULT_VIEW;
  const [dragPreview, setDragPreview] = useState<{
    ids: ReadonlySet<string>;
    dx: number;
    dy: number;
  } | null>(null);
  // A drag ends in a click — on the station if the pointer stayed on it, on the svg root if it
  // finished over open water (the click retargets to the common ancestor). Both would otherwise
  // read as "select this" / "add a station here", so the gesture swallows the next click.
  const swallowClick = useRef(false);

  const cities = useMemo(() => {
    if (!dragPreview) return draft.cities;
    const { ids, dx, dy } = dragPreview;
    return draft.cities.map((c) => (ids.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c));
  }, [draft.cities, dragPreview]);

  const frame = useMemo(() => {
    if (!selectedCities || selectedCities.size < 2) return null;
    return selectionBounds(cities.filter((c) => selectedCities.has(c.id)));
  }, [cities, selectedCities]);

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
    () => buildRouteGeometryFor(cities, routesForGeometry),
    [cities, routesForGeometry],
  );

  // The tier the Stops inspector authors is what gates a label's level of detail in-game, so the
  // canvas feeds it back the same way the live board does — an unset tier is 'minor', exactly as
  // the published content will read it.
  const tiers = useMemo(
    () => new Map(draft.cities.map((c) => [c.id, c.tier ?? 'minor'])),
    [draft.cities],
  );

  const onCityPointerDown = (id: string, e: React.PointerEvent) => {
    if (!cityDrag || !svgRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ids = cityDrag.begin(id, e);
    if (!ids || ids.size === 0) return;
    const svg = svgRef.current;
    const origin = clientToBoardPoint(svg, e.clientX, e.clientY);
    if (!origin) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    let last = { dx: 0, dy: 0 };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_SLOP_PX) return;
      moved = true;
      const p = clientToBoardPoint(svg, ev.clientX, ev.clientY);
      if (!p) return;
      last = { dx: p.x - origin.x, dy: p.y - origin.y };
      setDragPreview({ ids, ...last });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragPreview(null);
      if (!moved) return;
      // The click for this gesture is dispatched right after pointerup, before any timer runs.
      swallowClick.current = true;
      window.setTimeout(() => {
        swallowClick.current = false;
      }, 0);
      cityDrag.commit(ids, last.dx, last.dy);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onHandlePointerDown = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!curveHandle || !svgRef.current) return;
    const route = draft.routes.find((r) => r.id === curveHandle.routeId);
    const a = route && cities.find((c) => c.id === route.a);
    const b = route && cities.find((c) => c.id === route.b);
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
    if (swallowClick.current) return;
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('land')) return;
    const pt = clientToBoardPoint(svgRef.current, e.clientX, e.clientY);
    if (pt) onBackgroundClick(pt);
  };

  const handleCityClick = (id: string, mods?: ClickModifiers) => {
    if (swallowClick.current) return;
    onCityClick?.(id, mods);
  };

  return (
    <div className="editor-canvas-inner" ref={zoomVarRef}>
      <TransformWrapper
        // Same pan/zoom envelope as the live board (Board.tsx) — matching bounds keep
        // --inv-scale/--marker-scale (so city-label size and route/track weight) identical to
        // in-game at every zoom step, not just at rest.
        minScale={0.8}
        maxScale={8}
        initialScale={1.9}
        centerOnInit
        // Frame the geography to the viewport once measured (same as the live board), so the
        // canvas settles at the same effective zoom the game uses — otherwise a flat initialScale
        // leaves --inv-scale (and so city-label size) far bigger than in-game.
        onInit={(ref) => frameHome(ref, 0)}
        wheel={{ step: 0.0022 }}
        // A stage that drags stations owns the press on a marker outright; everywhere else a
        // press on one still starts a pan, as it always has. (Two-finger pinch is unaffected —
        // the library only runs this exclusion for single-pointer panning.)
        panning={{ excluded: cityDrag ? ['curve-handle', 'editor-city'] : ['curve-handle'] }}
      >
        <ZoomVar targetRef={zoomVarRef} />
        <CanvasControls fitHome />
        {/* contentStyle overrides the library's default `width/height: fit-content` on the inner
            content div — without it the SVG's own 100%/100% resolves against an indefinite parent
            and falls back to its tiny intrinsic size instead of filling (and tracking) the viewport. */}
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <MapScene
            svgRef={svgRef}
            className={dragPreview ? 'editor-canvas editor-canvas--dragging' : 'editor-canvas'}
            cities={cities}
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
            cityTier={(id) => tiers.get(id) ?? 'minor'}
            routeClass={(r) =>
              'editor-route' +
              (selection?.kind === 'route' && selection.id === r.id
                ? ' editor-route--selected'
                : '')
            }
            cityClass={(c) =>
              'editor-city' +
              ((selection?.kind === 'city' && selection.id === c.id) || selectedCities?.has(c.id)
                ? ' editor-city--selected'
                : '') +
              (highlightCities?.has(c.id) ? ' editor-city--highlighted' : '')
            }
            onRouteClick={onRouteClick}
            {...(onCityClick ? { onCityClick: handleCityClick } : {})}
            {...(cityDrag ? { onCityPointerDown } : {})}
          >
            {/* The group the Stops stage moves as one: a surveyor's plot around the selected
                stations, with its centre marked — that centre is exactly where a "move selected"
                click lands the group. */}
            {frame && (
              <g className="selection-frame" aria-hidden>
                <rect
                  x={frame.minX - FRAME_PAD}
                  y={frame.minY - FRAME_PAD}
                  width={frame.maxX - frame.minX + FRAME_PAD * 2}
                  height={frame.maxY - frame.minY + FRAME_PAD * 2}
                />
                <path
                  className="selection-anchor"
                  d={`M${frame.cx - ANCHOR_ARM} ${frame.cy}H${frame.cx + ANCHOR_ARM}M${frame.cx} ${frame.cy - ANCHOR_ARM}V${frame.cy + ANCHOR_ARM}`}
                />
              </g>
            )}
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
