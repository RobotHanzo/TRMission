# Plan: Replace Taiwan silhouette with real geographic boundary data

## Context

The hand-authored `TAIWAN_OUTLINE` points in `apps/web/src/game/geography.ts` produce a silhouette that is too stylized even after the prior tweak. The user wants to use real Taiwan coastline vectors from online.

The game board uses a **0–100 normalized coordinate space** (x=0 west, x=100 east; y=0 north, y=100 south). City positions are hand-placed in that space in `packages/map-data/src/cities.ts` and must not change (they affect `CONTENT_HASH` and persisted game replay). The island outline must contain all 33 land cities.

## Approach

1. **Fetch** Taiwan main island boundary GeoJSON from a reliable public source.
2. **Compute** a least-squares affine transform (6 parameters) using the 33 mainland cities as ground control points, mapping real lat/lon → game x/y.
3. **Apply** the transform to the boundary vertices to get game-space coordinates.
4. **Simplify** to ~35–50 points using Ramer-Douglas-Peucker (RDP).
5. **Expand** each point radially from the centroid by a small margin (≈2–3 units) so that the Catmull-Rom smoothing can't clip any city.
6. **Verify** all 33 land cities are inside the polygon.
7. **Update** `TAIWAN_OUTLINE` in `geography.ts`.

## Implementation

### Step 1 — Fetch GeoJSON

Use `WebFetch` to get a simplified Taiwan outline. Primary source (simplified Natural Earth-derived, public domain):

```
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
```
Filter `properties.ADMIN == "Taiwan"` or `properties.ISO_A2 == "TW"`. Use the exterior ring of the main island polygon only (skip any inner rings; multipolygons take the largest polygon by vertex count = main island).

Fallback source if the above is too large:
```
https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson
```

### Step 2 — Node.js script to compute, transform, simplify

Run inline with `node -e '...'`. The script:

```
a. Hardcode 33 city ground-control pairs [lon, lat, gameX, gameY]
b. Form the 3×3 normal equations for x = a·lon + b·lat + c and y = d·lon + e·lat + f
   (each a separate overdetermined linear system solved by least squares)
c. Solve via Cramer's rule on the 3×3 [A^T·A] matrix
d. Apply transform to all GeoJSON ring vertices
e. RDP simplification (ε ≈ 0.6 game units) to reduce to ≤ 50 points
f. Expand each point by factor 1.06 from centroid (≈ 3% radial pad for smoothing overshoot)
g. Point-in-polygon test: assert all 33 land cities inside
h. Print the JS array literal ready to paste
```

### Step 3 — Update `geography.ts`

Replace the `TAIWAN_OUTLINE` constant (currently lines 56–82, updated version, in `apps/web/src/game/geography.ts`) with the computed array. The `CENTRAL_RANGE` and `ISLANDS` blobs are unchanged.

### Step 4 — Adjust `CENTRAL_RANGE` if needed

After seeing the new silhouette, visually check that the relief blob (`CENTRAL_RANGE`, lines 90–103) still sits comfortably inside the east coast. The east coast will move significantly (it was over-extruded in the old shape). The central range points are x≈47–59 / y≈19–75; if they poke outside the new narrower east coast, nudge the eastern points left by 1–2 units.

## Files changed

- `apps/web/src/game/geography.ts` — `TAIWAN_OUTLINE` array only.

## Verification

1. Run `yarn workspace @trm/web typecheck` — pure data, should be clean.
2. Start `yarn workspace @trm/web dev` and open `:5173` (requires `docker compose up -d mongo`; or with `TRM_PERSISTENCE=0` the server still serves the client).
3. Visually confirm:
   - All city dots sit on land.
   - The silhouette matches Taiwan's distinctive shape: straight steep east coast, convex west belly, narrow Hengchun peninsula, broad flat north.
   - Central mountain range relief blob is still inside the coast.
4. Check `RoutePreview.tsx` mini-map on ticket cards looks right.
