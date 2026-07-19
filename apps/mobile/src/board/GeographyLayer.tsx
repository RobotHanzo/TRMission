// The map's cartography — a Skia port of the web Geography.tsx (apps/web/src/components/Geography.tsx)
// drawn with the shared MapPalette / MAP_DIMS tokens. The palette arrives as a prop (light or dark,
// resolved by BoardView from the app theme — the web equivalent is tokens.css swapping --tr-sea etc.).
// `geography === null` → the hand-authored Taiwan coast + central-range relief + islands; otherwise a
// custom map's cropped-world land rings (one smoothed path each). Only the graticule counter-scales
// (web --inv-scale); land/relief strokes are fixed board-unit weights like the web CSS.
import { useMemo } from 'react';
import {
  Circle,
  DashPathEffect,
  Group,
  Line,
  Path,
  Rect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import type { SkPath } from '@shopify/react-native-skia';
import {
  MAP_DIMS,
  MAP_PALETTE_LIGHT,
  TAIWAN_LAND_PATH,
  TAIWAN_CENTRAL_RANGE_PATH,
  TAIWAN_ISLANDS,
  smoothClosedPath,
  type MapGeography,
  type MapPalette,
} from '@trm/map-data';

const D = MAP_DIMS;

export interface BoardView {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Grid lines at a fixed 20-unit step across the view (the web's `graticuleFor`). */
function graticule(view: BoardView): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  for (let x = Math.ceil(view.x / 20) * 20; x < view.x + view.w; x += 20) xs.push(x);
  const ys: number[] = [];
  for (let y = Math.ceil(view.y / 20) * 20; y < view.y + view.h; y += 20) ys.push(y);
  return { xs, ys };
}

export interface GeographyLayerProps {
  geography: MapGeography | null;
  view: BoardView;
  /** Graticule counter-scale (web --inv-scale). */
  inv: number;
  /** Themed cartography palette (light default keeps specimens/tests on the classic look). */
  palette?: MapPalette | undefined;
}

export function GeographyLayer({
  geography,
  view,
  inv,
  palette: P = MAP_PALETTE_LIGHT,
}: GeographyLayerProps) {
  const taiwanLand = useMemo(() => Skia.Path.MakeFromSVGString(TAIWAN_LAND_PATH), []);
  const taiwanRelief = useMemo(() => Skia.Path.MakeFromSVGString(TAIWAN_CENTRAL_RANGE_PATH), []);
  const customRings = useMemo<SkPath[]>(
    () =>
      geography
        ? geography.land
            .map((ring) => Skia.Path.MakeFromSVGString(smoothClosedPath(ring)))
            .filter((p): p is SkPath => !!p)
        : [],
    [geography],
  );
  const grat = useMemo(() => graticule(view), [view.x, view.y, view.w, view.h]);
  const gratW = D.graticuleW * inv;

  return (
    <Group>
      {/* Open sea, generously overscanned so panning never reveals an edge. */}
      <Rect
        x={view.x - 40}
        y={view.y - 40}
        width={view.w + 80}
        height={view.h + 80}
        color={P.sea}
      />
      <Group>
        {grat.ys.map((y) => (
          <Line
            key={`gy${y}`}
            p1={vec(view.x - 6, y)}
            p2={vec(view.x + view.w + 6, y)}
            style="stroke"
            strokeWidth={gratW}
            color={P.seaLine}
          >
            <DashPathEffect intervals={[D.graticuleDashA * inv, D.graticuleDashB * inv]} />
          </Line>
        ))}
        {grat.xs.map((x) => (
          <Line
            key={`gx${x}`}
            p1={vec(x, view.y - 4)}
            p2={vec(x, view.y + view.h + 4)}
            style="stroke"
            strokeWidth={gratW}
            color={P.seaLine}
          >
            <DashPathEffect intervals={[D.graticuleDashA * inv, D.graticuleDashB * inv]} />
          </Line>
        ))}
      </Group>

      {geography === null ? (
        <>
          {taiwanLand && (
            <>
              {/* Soft sea-coloured halo just off the coast, then the land + coastline. */}
              <Path
                path={taiwanLand}
                style="stroke"
                strokeWidth={D.landSurfW}
                color={P.sea}
                opacity={D.landSurfOpacity}
              />
              <Path path={taiwanLand} color={P.land} />
              <Path
                path={taiwanLand}
                style="stroke"
                strokeWidth={D.landStrokeW}
                strokeJoin="round"
                color={P.coast}
              />
            </>
          )}
          {taiwanRelief && (
            <>
              <Path path={taiwanRelief} color={P.relief} opacity={D.reliefOpacity} />
              <Path
                path={taiwanRelief}
                style="stroke"
                strokeWidth={D.reliefRidgeW}
                color={P.coast}
                opacity={D.reliefOpacity}
              />
            </>
          )}
          <Group>
            {TAIWAN_ISLANDS.map((b, i) => (
              <Group key={`is${i}`}>
                <Circle cx={b.cx} cy={b.cy} r={b.r} color={P.land} />
                <Circle
                  cx={b.cx}
                  cy={b.cy}
                  r={b.r}
                  style="stroke"
                  strokeWidth={D.geoIslandStrokeW}
                  color={P.coast}
                />
              </Group>
            ))}
          </Group>
        </>
      ) : (
        customRings.map((ring, i) => (
          <Group key={`ring${i}`}>
            <Path
              path={ring}
              style="stroke"
              strokeWidth={D.landSurfW}
              color={P.sea}
              opacity={D.landSurfOpacity}
            />
            <Path path={ring} color={P.land} />
            <Path
              path={ring}
              style="stroke"
              strokeWidth={D.landStrokeW}
              strokeJoin="round"
              color={P.coast}
            />
          </Group>
        ))
      )}
    </Group>
  );
}
