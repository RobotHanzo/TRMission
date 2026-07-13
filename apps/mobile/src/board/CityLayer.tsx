// City + station markers — a Skia port of the MapScene city branch (apps/web/src/components/
// MapScene.tsx). Hub junctions read as a wider slot; ordinary stops are round dots. A player's
// station sits inside the marker in their seat colour; an offered-ticket endpoint gets a soft
// halo. Markers size off `marker` (web --marker-scale), so they GROW as you zoom in (easier to
// aim at) while still shrinking on the whole-island view. (The just-built station pop is a LIVE
// overlay in MapSceneSkia — this layer is recorded into the cached static Picture and must stay
// animation-free.)
import { Circle, Group, RoundedRect } from '@shopify/react-native-skia';
import { MAP_DIMS, MAP_PALETTE_LIGHT } from '@trm/map-data';
import { seatColor } from '../theme/colors';
import type { SceneCity } from './MapSceneSkia';

const D = MAP_DIMS;
const P = MAP_PALETTE_LIGHT;

export interface CityLayerProps {
  cities: readonly SceneCity[];
  hubs: ReadonlySet<string>;
  stations?: ReadonlyMap<string, number> | undefined;
  highlightCities?: ReadonlySet<string> | undefined;
  /** Marker growth (web --marker-scale). */
  marker: number;
}

export function CityLayer({ cities, hubs, stations, highlightCities, marker }: CityLayerProps) {
  return (
    <>
      {cities.map((c) => {
        const isHub = hubs.has(c.id);
        const stationSeat = stations?.get(c.id);
        const hasStation = stationSeat !== undefined;
        const isTarget = highlightCities?.has(c.id) ?? false;
        const r = (c.isIsland ? D.islandR : D.cityR) * marker;
        const dotStroke = c.isIsland ? P.blue : P.ink;
        const hubW = D.hubW * marker;
        const hubH = D.hubH * marker;

        return (
          <Group key={c.id}>
            {isTarget && <Circle cx={c.x} cy={c.y} r={r * 2.4} color={P.blue} opacity={0.16} />}

            {isHub ? (
              <>
                <RoundedRect
                  x={c.x - hubW / 2}
                  y={c.y - hubH / 2}
                  width={hubW}
                  height={hubH}
                  r={D.hubRx * marker}
                  color={P.surface}
                />
                <RoundedRect
                  x={c.x - hubW / 2}
                  y={c.y - hubH / 2}
                  width={hubW}
                  height={hubH}
                  r={D.hubRx * marker}
                  style="stroke"
                  strokeWidth={D.cityStrokeW * marker}
                  color={P.ink}
                />
              </>
            ) : (
              <>
                <Circle cx={c.x} cy={c.y} r={r} color={P.surface} />
                <Circle
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  style="stroke"
                  strokeWidth={D.cityStrokeW * marker}
                  color={dotStroke}
                />
              </>
            )}

            {hasStation &&
              (isHub ? (
                <RoundedRect
                  x={c.x - 0.75 * marker}
                  y={c.y - 0.45 * marker}
                  width={1.5 * marker}
                  height={0.9 * marker}
                  r={0.4 * marker}
                  color={seatColor(stationSeat)}
                />
              ) : (
                <>
                  <Circle cx={c.x} cy={c.y} r={0.7 * marker} color={seatColor(stationSeat)} />
                  <Circle
                    cx={c.x}
                    cy={c.y}
                    r={0.7 * marker}
                    style="stroke"
                    strokeWidth={0.28 * marker}
                    color={P.surface}
                  />
                </>
              ))}
          </Group>
        );
      })}
    </>
  );
}
