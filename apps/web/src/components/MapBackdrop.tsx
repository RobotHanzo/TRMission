import { memo, type CSSProperties } from 'react';
import type { RouteColor } from '@trm/shared';
import { CITIES, ROUTES } from '../game/content';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../theme/colors';
import { BASE_VIEW } from '../game/geography';
import { Geography } from './Geography';
import '../styles/game.css';

const VIEWBOX = `${BASE_VIEW.x} ${BASE_VIEW.y} ${BASE_VIEW.w} ${BASE_VIEW.h}`;
const colorOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.hex : CARD_COLOR_TOKENS[rc].hex;

// `.board` reads --inv-scale (≈1/zoom) for its track/marker weights, but that var is normally set
// live on the in-game `.board-viewport`. The backdrop has no viewport, so pin it to the home value.
const STATIC_BOARD_STYLE = { '--inv-scale': 0.53 } as CSSProperties;

/**
 * A static, non-interactive render of the Taiwan board — the same cartography and railway network
 * the game draws, in their base route colours, with no labels, ownership, glow, or pan/zoom. Used
 * purely as the decorative (blurred) backdrop on the login screen; `preserveAspectRatio="slice"`
 * makes it cover the area like `background-size: cover`. Memoised: it never changes.
 */
export const MapBackdrop = memo(function MapBackdrop() {
  return (
    <div className="login-backdrop" aria-hidden>
      <svg
        className="board"
        viewBox={VIEWBOX}
        preserveAspectRatio="xMidYMid slice"
        style={STATIC_BOARD_STYLE}
      >
        <Geography />

        {ROUTES.map((r) => {
          const g = ROUTE_GEOMETRY.get(r.id as string);
          if (!g) return null;
          const fill = colorOf(r.color);
          const isFerry = r.ferryLocos > 0;
          const kind = r.isTunnel ? ' tunnel' : isFerry ? ' ferry' : '';
          const groupStyle: CSSProperties | undefined =
            g.perp.x || g.perp.y
              ? {
                  transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
                }
              : undefined;
          return (
            <g key={r.id as string} className={`route${kind}`} style={groupStyle}>
              {r.isTunnel && <path className="tunnel-bg" d={g.path} />}
              <path className="bed" d={g.path} />
              {r.isTunnel && g.ties?.map((t, i) => (
                <rect
                  key={i}
                  className="tunnel-tie"
                  transform={`translate(${t.x.toFixed(2)} ${t.y.toFixed(2)}) rotate(${(t.angle + 45).toFixed(1)})`}
                />
              ))}
              {isFerry ? (
                <>
                  <path className="ferry-line" d={g.path} />
                  {g.slots.map((s, i) => (
                    <circle key={i} className="ferry-pip" cx={s.x} cy={s.y} fill={fill} />
                  ))}
                </>
              ) : (
                g.slots.map((s, i) => (
                  <rect
                    key={i}
                    className="slot"
                    x={-s.len / 2}
                    width={s.len}
                    fill={fill}
                    transform={`translate(${s.x.toFixed(2)} ${s.y.toFixed(2)}) rotate(${s.angle.toFixed(1)})`}
                  />
                ))
              )}
            </g>
          );
        })}

        {CITIES.map((c) => {
          const isHub = HUB_CITIES.has(c.id as string);
          const cls = 'city' + (c.isIsland ? ' island' : '') + (isHub ? ' hub' : '');
          return (
            <g key={c.id as string} className={cls}>
              {isHub ? (
                <rect className="city-hub" transform={`translate(${c.x} ${c.y})`} />
              ) : (
                <circle className="city-dot" cx={c.x} cy={c.y} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
});
