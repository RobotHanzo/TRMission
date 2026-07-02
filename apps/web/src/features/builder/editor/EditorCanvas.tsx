import { useRef } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import type { CityDraft, RouteDraft } from '../../../net/rest';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../../theme/colors';
import { CustomGeography } from '../../../components/Geography';
import { clientToBoardPoint } from './canvasProjection';
import { useEditorStore } from './store';

const DEFAULT_VIEW = { x: 0, y: 0, w: 100, h: 100 };
const DOUBLE_GAP = 1.2;

const colorOf = (c: string): string =>
  c === 'GRAY' ? GRAY_TOKEN.hex : (CARD_COLOR_TOKENS[c as keyof typeof CARD_COLOR_TOKENS]?.hex ?? '#888');

function offsetFor(route: RouteDraft, all: readonly RouteDraft[]): { nx: number; ny: number; gap: number } {
  if (!route.doubleGroup) return { nx: 0, ny: 0, gap: 0 };
  const siblings = all.filter((r) => r.doubleGroup === route.doubleGroup).map((r) => r.id).sort();
  const idx = siblings.indexOf(route.id);
  const gap = (idx - (siblings.length - 1) / 2) * DOUBLE_GAP;
  return { nx: 0, ny: 0, gap };
}

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
 * feel), the crop's land silhouette as a backdrop when present, and simple straight-line
 * cities/routes — the builder trades the live board's curve/bow polish for a canvas that is
 * cheap to reason about and independent of the live-game rendering singleton (game/catalog.ts).
 */
export function EditorCanvas({
  onBackgroundClick,
  onCityClick,
  onRouteClick,
  highlightCities,
}: EditorCanvasProps) {
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const view = draft.geography?.baseView ?? DEFAULT_VIEW;
  const viewBox = `${view.x} ${view.y} ${view.w} ${view.h}`;
  const cityById = new Map(draft.cities.map((c) => [c.id, c]));

  const handleBackgroundClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onBackgroundClick || !svgRef.current) return;
    if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('land')) return;
    const pt = clientToBoardPoint(svgRef.current, e.clientX, e.clientY);
    if (pt) onBackgroundClick(pt);
  };

  return (
    <TransformWrapper minScale={0.5} maxScale={10} initialScale={1} centerOnInit wheel={{ step: 0.15 }}>
      <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
        <svg
          ref={svgRef}
          className="board editor-canvas"
          viewBox={viewBox}
          role="img"
          aria-label="editor canvas"
          onClick={handleBackgroundClick}
        >
          {draft.geography && <CustomGeography geography={draft.geography} />}
          <g className="routes">
            {draft.routes.map((r) => {
              const a = cityById.get(r.a);
              const b = cityById.get(r.b);
              if (!a || !b) return null;
              const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              const nx = -(b.y - a.y) / len;
              const ny = (b.x - a.x) / len;
              const { gap } = offsetFor(r, draft.routes);
              const ox = nx * gap;
              const oy = ny * gap;
              const selected = selection?.kind === 'route' && selection.id === r.id;
              return (
                <line
                  key={r.id}
                  x1={a.x + ox}
                  y1={a.y + oy}
                  x2={b.x + ox}
                  y2={b.y + oy}
                  stroke={colorOf(r.color)}
                  strokeWidth={selected ? 1.6 : 1}
                  strokeDasharray={r.isTunnel ? '0.6,0.6' : r.ferryLocos > 0 ? '0.3,0.9' : undefined}
                  strokeLinecap="round"
                  className="editor-route"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRouteClick?.(r.id);
                  }}
                />
              );
            })}
          </g>
          <g className="cities">
            {draft.cities.map((c: CityDraft) => {
              const selected = selection?.kind === 'city' && selection.id === c.id;
              const highlighted = highlightCities?.has(c.id);
              return (
                <g
                  key={c.id}
                  transform={`translate(${c.x},${c.y})`}
                  className="editor-city"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCityClick?.(c.id);
                  }}
                >
                  <circle
                    r={selected ? 1.6 : highlighted ? 1.4 : 1.1}
                    fill={c.isIsland ? '#0f5fa6' : '#2b2d31'}
                    stroke={selected ? '#e07a1f' : highlighted ? '#e07a1f' : '#fff'}
                    strokeWidth={selected || highlighted ? 0.4 : 0.2}
                  />
                  <text y={-1.8} textAnchor="middle" className="editor-city-label">
                    {c.nameZh}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </TransformComponent>
    </TransformWrapper>
  );
}
