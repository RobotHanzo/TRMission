// City labels — the level-of-detail text layer. Which labels show at a given zoom ports the web's
// [data-zoom] CSS ladder (game.css) via the shared game/lod.ts tiers: `far` shows major only, each
// wider bucket reveals the next tier, `local` shows all; islands always keep their label. Text is
// drawn through the guarded system-font BoardText (CJK-capable), so a build without the Paragraph
// API simply shows no labels rather than crashing — the markers/routes stay fully visible.
import { MAP_DIMS, MAP_PALETTE_LIGHT } from '@trm/map-data';
import { BoardText } from './skiaText';
import type { ZoomBucket } from './camera';
import type { CityTier } from '../game/lod';
import type { SceneCity } from './MapSceneSkia';

const D = MAP_DIMS;
const P = MAP_PALETTE_LIGHT;

const BUCKET_RANK: Record<ZoomBucket, number> = { far: 0, regional: 1, district: 2, local: 3 };
const TIER_RANK: Record<CityTier, number> = { major: 0, secondary: 1, tertiary: 2, minor: 3 };

/** Ports the [data-zoom] visibility ladder: a tier's labels appear once the zoom bucket reaches it. */
export function tierVisible(tier: string, bucket: ZoomBucket): boolean {
  const rank = TIER_RANK[tier as CityTier] ?? TIER_RANK.minor;
  return BUCKET_RANK[bucket] >= rank;
}

/** Label size in board units at base zoom; * inv holds a constant on-screen size, like the web. */
const LABEL_SIZE = 2.6;

export interface LabelLayerProps {
  cities: readonly SceneCity[];
  cityLabel?: ((c: SceneCity) => string) | undefined;
  cityTier?: ((id: string) => string) | undefined;
  bucket: ZoomBucket;
  /** Label counter-scale (web --inv-scale). */
  inv: number;
  /** Marker growth — labels sit just below the marker, whose radius scales with this. */
  marker: number;
}

export function LabelLayer({ cities, cityLabel, cityTier, bucket, inv, marker }: LabelLayerProps) {
  if (!cityLabel) return null;
  return (
    <>
      {cities.map((c) => {
        const tier = cityTier?.(c.id) ?? 'minor';
        if (!c.isIsland && !tierVisible(tier, bucket)) return null;
        const label = cityLabel(c);
        if (!label) return null;
        const markerR = (c.isIsland ? D.islandR : D.cityR) * marker;
        return (
          <BoardText
            key={c.id}
            text={label}
            x={c.x}
            y={c.y + markerR + 0.4}
            size={LABEL_SIZE * inv}
            color={P.ink}
          />
        );
      })}
    </>
  );
}
