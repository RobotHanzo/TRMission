import { useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../../theme/colors';
import { CustomGeography } from '../../../components/Geography';
import { RouteShape, FerryLocoGradientDef } from '../../../components/RouteShape';
import { buildRouteGeometryFor } from '../../../game/routeGeometry';
import { clientToBoardPoint } from './canvasProjection';
import { CanvasControls } from './CanvasControls';
import { ZoomVar } from './ZoomVar';
import { useEditorStore } from './store';
import '../../../styles/game.css';

const DEFAULT_VIEW = { x: 0, y: 0, w: 100, h: 100 };

const colorOf = (c: string): string =>
  c === 'GRAY' ? GRAY_TOKEN.hex : (CARD_COLOR_TOKENS[c as keyof typeof CARD_COLOR_TOKENS]?.hex ?? '#888');

export interface EditorCanvasProps {
  /** Empty-canvas / land click, in board units — placing a new city, or a no-op if the stage
   *  doesn't handle placement (e.g. the Missions stage never renders this canvas at all). */
  onBackgroundClick?: (point: { x: number; y: number }) => void;
  onCityClick?: (id: string) => void;
  onRouteClick?: (id: string) => void;
  /** City ids to visually highlight (e.g. the two endpoints picked mid-route-creation). */
  highlightCities?: ReadonlySet<string>;
}

/**
 * The shared SVG workspace for the Stops/Routes stages: pan/zoom (matching the live board's
 * feel) and the exact live-board cartography — `RouteShape`'s curved roadbed/cars/tunnel-ties/
 * ferry-pips and the `city-dot`/`city-hub`/`city-label` markers, driven by the same
 * `game/routeGeometry.ts` curve/bow/hub math (via `buildRouteGeometryFor`, its draft-content
 * escape hatch) — so an authored map previews exactly as it will play, independent of the
 * live-game rendering singleton (game/catalog.ts).
 */
export function EditorCanvas({
  onBackgroundClick,
  onCityClick,
  onRouteClick,
  highlightCities,
}: EditorCanvasProps) {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);
  const view = draft.geography?.baseView ?? DEFAULT_VIEW;
  const viewBox = `${view.x} ${view.y} ${view.w} ${view.h}`;

  const { geometry, hubs } = useMemo(
    () => buildRouteGeometryFor(draft.cities, draft.routes),
    [draft.cities, draft.routes],
  );

  const handleBackgroundClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onBackgroundClick || !svgRef.current) return;
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('land')) return;
    const pt = clientToBoardPoint(svgRef.current, e.clientX, e.clientY);
    if (pt) onBackgroundClick(pt);
  };

  return (
    <div className="editor-canvas-inner" ref={zoomVarRef}>
      <TransformWrapper minScale={0.5} maxScale={12} initialScale={1} centerOnInit wheel={{ step: 0.0022 }}>
        <ZoomVar targetRef={zoomVarRef} />
        <CanvasControls />
        {/* contentStyle overrides the library's default `width/height: fit-content` on the inner
            content div — without it the SVG's own 100%/100% resolves against an indefinite parent
            and falls back to its tiny intrinsic size instead of filling (and tracking) the viewport. */}
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <svg
            ref={svgRef}
            className="board editor-canvas"
            viewBox={viewBox}
            role="img"
            aria-label={t('builder.canvasLabel')}
            onClick={handleBackgroundClick}
          >
            <FerryLocoGradientDef />
            {draft.geography && <CustomGeography geography={draft.geography} />}
            {draft.routes.map((r) => {
              const g = geometry.get(r.id);
              if (!g) return null;
              const isFerry = r.ferryLocos > 0;
              const selected = selection?.kind === 'route' && selection.id === r.id;
              const cls =
                'route editor-route' +
                (r.isTunnel ? ' tunnel' : isFerry ? ' ferry' : '') +
                (selected ? ' editor-route--selected' : '');
              const style: CSSProperties = g.perp.x || g.perp.y
                ? {
                    transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
                  }
                : {};
              return (
                <g
                  key={r.id}
                  className={cls}
                  style={style}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRouteClick?.(r.id);
                  }}
                >
                  <RouteShape
                    geometry={g}
                    isTunnel={r.isTunnel}
                    isFerry={isFerry}
                    ferryLocos={r.ferryLocos}
                    length={r.length}
                    fill={colorOf(r.color)}
                  />
                  <path className="hit" d={g.path} />
                </g>
              );
            })}
            {draft.cities.map((c) => {
              const isHub = hubs.has(c.id);
              const selected = selection?.kind === 'city' && selection.id === c.id;
              const highlighted = highlightCities?.has(c.id);
              const cls =
                'city editor-city' +
                (c.isIsland ? ' island' : '') +
                (isHub ? ' hub' : '') +
                (selected ? ' editor-city--selected' : '') +
                (highlighted ? ' editor-city--highlighted' : '');
              return (
                <g
                  key={c.id}
                  className={cls}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCityClick?.(c.id);
                  }}
                >
                  {isHub ? (
                    <rect className="city-hub" transform={`translate(${c.x} ${c.y})`} />
                  ) : (
                    <circle className="city-dot" cx={c.x} cy={c.y} />
                  )}
                  <text className="city-label" x={c.x} y={c.y}>
                    {c.nameZh}
                  </text>
                </g>
              );
            })}
          </svg>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}
