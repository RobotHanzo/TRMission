import { useTranslation } from 'react-i18next';
import { smoothClosedPath, type MapGeography } from '@trm/map-data';

interface PreviewCity {
  id: string;
  x: number;
  y: number;
}
interface PreviewRoute {
  a: string;
  b: string;
}

const GRATICULE_STEP = 20;
/** Hard cap on grid lines per axis. A moderated draft's `baseView` is attacker-controlled and only
 *  bounded by `finite().positive()` on the way in, so the walk can never be driven by the span
 *  alone: a real map is ~100 units across (5 lines), and 1000 lines is already unreadable. */
const GRATICULE_MAX_LINES = 1000;

/** Lines along one axis at a fixed step, clipped to `[start, start + span)`. Walked by index rather
 *  than by accumulation so a huge or extreme-coordinate span can't spin forever — at very large
 *  coordinates `+= step` falls below the float ULP and never advances. */
function axisLines(start: number, span: number) {
  const first = Math.ceil(start / GRATICULE_STEP) * GRATICULE_STEP;
  const end = start + span;
  const out: number[] = [];
  let prev: number | undefined;
  for (let i = 0; i < GRATICULE_MAX_LINES; i++) {
    const v = first + i * GRATICULE_STEP;
    if (!(v < end) || v === prev) break;
    out.push(v);
    prev = v;
  }
  return out;
}

/** Grid lines at a fixed step, clipped to the given view — mirrors apps/web's Geography.tsx. */
function graticuleLines(view: { x: number; y: number; w: number; h: number }) {
  return { xs: axisLines(view.x, view.w), ys: axisLines(view.y, view.h) };
}

/** Read-only board-shape glance for moderation: the draft's own land silhouette (when it has
 *  authored one) behind cities as dots and routes as lines, in the draft's own coordinate space.
 *  No interactivity, no dependency on the game's real board renderer (apps/web) — this is inert
 *  content, not live game state. */
export function MapPreview({
  draft,
}: {
  draft: { cities: PreviewCity[]; routes: PreviewRoute[]; geography?: MapGeography };
}) {
  const { t } = useTranslation();
  if (draft.cities.length === 0) {
    return <p className="oc-muted">{t('maps.previewEmpty')}</p>;
  }
  const byId = new Map(draft.cities.map((c) => [c.id, c]));
  const geo = draft.geography;
  const view = geo?.baseView ?? { x: 0, y: 0, w: 100, h: 100 };
  const { xs, ys } = geo ? graticuleLines(view) : { xs: [], ys: [] };
  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="oc-map-preview"
      role="img"
      aria-label={t('maps.preview')}
    >
      {geo && (
        <g className="oc-map-geo">
          <rect
            className="sea"
            x={view.x - 10}
            y={view.y - 10}
            width={view.w + 20}
            height={view.h + 20}
          />
          <g className="graticule">
            {ys.map((y) => (
              <line key={`gy${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} />
            ))}
            {xs.map((x) => (
              <line key={`gx${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} />
            ))}
          </g>
          {geo.land.map((ring, i) => (
            <path key={i} className="land" d={smoothClosedPath(ring)} />
          ))}
        </g>
      )}
      {draft.routes.map((r, i) => {
        const a = byId.get(r.a);
        const b = byId.get(r.b);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeWidth={0.4}
          />
        );
      })}
      {draft.cities.map((c) => (
        <circle key={c.id} cx={c.x} cy={c.y} r={1.2} fill="currentColor" />
      ))}
    </svg>
  );
}
