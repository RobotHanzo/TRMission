import { useMemo } from 'react';
import type { GameSnapshot } from '@trm/proto';
import type { RouteColor } from '@trm/shared';
import { CITIES, ROUTES, cityById, cityName } from '../game/content';
import { ownershipMap } from '../game/view';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, SEAT_COLORS } from '../theme/colors';
import type { Locale } from '../store/ui';

interface BoardProps {
  snapshot: GameSnapshot;
  locale: Locale;
  colorBlind: boolean;
  canAct: boolean;
  onPickRoute(routeId: string): void;
  onPickCity(cityId: string): void;
}

// Perpendicular offset for double-route siblings so the parallel tracks don't overlap.
const doubleOffsets = (): Map<string, number> => {
  const groups = new Map<string, string[]>();
  for (const r of ROUTES)
    if (r.doubleGroup)
      groups.set(r.doubleGroup, [...(groups.get(r.doubleGroup) ?? []), r.id as string]);
  const m = new Map<string, number>();
  for (const ids of groups.values()) {
    ids.sort();
    ids.forEach((id, i) => m.set(id, (i - (ids.length - 1) / 2) * 1.8));
  }
  return m;
};

const colorOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.hex : CARD_COLOR_TOKENS[rc].hex;
const glyphOf = (rc: RouteColor): string =>
  rc === 'GRAY' ? GRAY_TOKEN.glyph : CARD_COLOR_TOKENS[rc].glyph;

export function Board({
  snapshot,
  locale,
  colorBlind,
  canAct,
  onPickRoute,
  onPickCity,
}: BoardProps) {
  const offsets = useMemo(doubleOffsets, []);
  const owned = useMemo(() => ownershipMap(snapshot), [snapshot]);
  const stationCities = useMemo(() => new Set(snapshot.stations.map((s) => s.cityId)), [snapshot]);

  return (
    <svg className="board" viewBox="-4 -3 86 98" role="img" aria-label="Taiwan railway map">
      <rect x="-4" y="-3" width="86" height="98" fill="var(--tr-surface-2)" rx="2" />

      {ROUTES.map((r) => {
        const a = cityById.get(r.a as string);
        const b = cityById.get(r.b as string);
        if (!a || !b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const off = offsets.get(r.id as string) ?? 0;
        const nx = (-dy / len) * off;
        const ny = (dx / len) * off;
        const x1 = a.x + nx;
        const y1 = a.y + ny;
        const x2 = b.x + nx;
        const y2 = b.y + ny;
        const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };

        const o = owned.get(r.id as string);
        const claimable = canAct && !o;
        const stroke =
          o?.ownerSeat !== undefined
            ? (SEAT_COLORS[o.ownerSeat % 5] ?? '#888')
            : o?.locked
              ? '#9aa0a6'
              : colorOf(r.color);
        const dash = r.isTunnel ? '2.4 1.6' : r.ferryLocos > 0 ? '0.6 1.8' : undefined;

        return (
          <g key={r.id as string} className={claimable ? 'route claimable' : 'route'}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeWidth={o ? 2.6 : 2.1}
              strokeLinecap="round"
              {...(dash ? { strokeDasharray: dash } : {})}
              opacity={o?.locked ? 0.45 : 1}
            />
            {claimable && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="transparent"
                strokeWidth={4}
                strokeLinecap="round"
                style={{ cursor: 'pointer' }}
                onClick={() => onPickRoute(r.id as string)}
              >
                <title>{`${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)} · ${r.length}`}</title>
              </line>
            )}
            {!o && (
              <g pointerEvents="none">
                <circle
                  cx={mid.x}
                  cy={mid.y}
                  r="1.5"
                  fill="var(--tr-surface)"
                  stroke={stroke}
                  strokeWidth="0.3"
                />
                <text
                  x={mid.x}
                  y={mid.y + 0.7}
                  fontSize="2"
                  textAnchor="middle"
                  fill="var(--tr-ink)"
                >
                  {colorBlind ? glyphOf(r.color) : r.length}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {CITIES.map((c) => {
        const hasStation = stationCities.has(c.id as string);
        const buildable = canAct && !hasStation;
        return (
          <g key={c.id as string}>
            <circle
              cx={c.x}
              cy={c.y}
              r={c.isIsland ? 1.7 : 1.4}
              fill="var(--tr-surface)"
              stroke="var(--tr-ink)"
              strokeWidth="0.4"
              style={buildable ? { cursor: 'pointer' } : undefined}
              onClick={buildable ? () => onPickCity(c.id as string) : undefined}
            >
              <title>{cityName(c.id as string, locale)}</title>
            </circle>
            {hasStation && (
              <rect x={c.x - 0.8} y={c.y - 0.8} width="1.6" height="1.6" fill="var(--tr-ember)" />
            )}
            <text x={c.x} y={c.y - 2} fontSize="1.9" textAnchor="middle" fill="var(--tr-ink-soft)">
              {cityName(c.id as string, locale)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
