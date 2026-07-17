// Precompute the per-route render model the RouteLayer draws: a parsed Skia bed path plus the
// geometry's car slots / tunnel ties / ferry data. Mirrors the web RouteShape.tsx + MapScene route
// branch (apps/web/src/components/{RouteShape,MapScene}.tsx) — the same @trm/map-data geometry, so
// the mobile board can never drift from the web board. Path parsing is the only non-pure bit; it
// goes through the Skia jest mock in tests.
import { Skia, type SkPath } from '@shopify/react-native-skia';
import type { RouteGeometry, Slot } from '@trm/map-data';
import type { SceneRoute } from './MapSceneSkia';

export interface RouteRenderModel {
  readonly id: string;
  /** Parsed roadbed / click-target path. */
  readonly bed: SkPath;
  readonly slots: readonly Slot[];
  /** Tunnel sleeper ties (empty for non-tunnels). */
  readonly ties: readonly Slot[];
  /** Perpendicular double-pair nudge (board units, before the --inv-scale counter-scale). */
  readonly perp: { readonly x: number; readonly y: number };
  /** Route midpoint (colour-blind glyph anchor). */
  readonly mid: { readonly x: number; readonly y: number };
  /** Route colour key (GRAY / RED / …). */
  readonly color: string;
  readonly length: number;
  readonly isTunnel: boolean;
  readonly isFerry: boolean;
  /** Count of required-wild locomotive pips (0 for a non-ferry). */
  readonly ferryLocos: number;
  /** >0 ⇒ broken rail (斷軌): that many centred car slots render damaged until repaired. */
  readonly brokenCarriages: number;
}

export function buildRouteRenderModel(
  routes: readonly SceneRoute[],
  geometry: ReadonlyMap<string, RouteGeometry>,
): RouteRenderModel[] {
  const out: RouteRenderModel[] = [];
  for (const r of routes) {
    const g = geometry.get(r.id);
    if (!g) continue;
    const bed = Skia.Path.MakeFromSVGString(g.path);
    if (!bed) continue;
    const ferryLocos = r.ferryLocos ?? 0;
    out.push({
      id: r.id,
      bed,
      slots: g.slots,
      ties: g.ties ?? [],
      perp: g.perp,
      mid: g.mid,
      color: r.color,
      length: r.length,
      isTunnel: !!r.isTunnel,
      isFerry: ferryLocos > 0,
      ferryLocos,
      brokenCarriages: r.brokenCarriages ?? 0,
    });
  }
  return out;
}

/**
 * Ports RouteShape.tsx's `locoStart` math: the `locos` required-wild pips form a centred block of
 * the `length`-long pip chain. Returns the half-open index range [start, end).
 */
export function ferryLocoBlock(length: number, locos: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor((length - locos) / 2));
  return { start, end: start + locos };
}
