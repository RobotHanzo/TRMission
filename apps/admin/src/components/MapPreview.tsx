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

/** Grid lines at a fixed step, clipped to the given view — mirrors apps/web's Geography.tsx. */
function graticuleLines(view: { x: number; y: number; w: number; h: number }) {
  const xs: number[] = [];
  for (
    let x = Math.ceil(view.x / GRATICULE_STEP) * GRATICULE_STEP;
    x < view.x + view.w;
    x += GRATICULE_STEP
  ) {
    xs.push(x);
  }
  const ys: number[] = [];
  for (
    let y = Math.ceil(view.y / GRATICULE_STEP) * GRATICULE_STEP;
    y < view.y + view.h;
    y += GRATICULE_STEP
  ) {
    ys.push(y);
  }
  return { xs, ys };
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
