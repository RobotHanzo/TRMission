// Equirectangular projection scaled by cos(midLat): locally aspect-true (matches how the
// Taiwan silhouette was hand-drawn — see game/geography.ts), trivially invertible, and stable
// enough for the crop tool's live preview. Not conformal at scale, but a cropped map spans at
// most a few hundred km, where the distortion is imperceptible.
export interface CropBBox {
  readonly lonMin: number;
  readonly lonMax: number;
  readonly latMin: number;
  readonly latMax: number;
}

export interface BoardView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Projection {
  readonly baseView: BoardView;
  project(lon: number, lat: number): readonly [number, number];
  unproject(x: number, y: number): readonly [number, number];
}

/** Sea margin around the cropped land, in board units — matches Taiwan's BASE_VIEW feel. */
const MARGIN = 4;
/** The longer side of the crop maps to this many board units before the margin is added. */
const TARGET_SPAN = 92;

export function isValidCrop(crop: CropBBox): boolean {
  return (
    Number.isFinite(crop.lonMin) &&
    Number.isFinite(crop.lonMax) &&
    Number.isFinite(crop.latMin) &&
    Number.isFinite(crop.latMax) &&
    crop.lonMin < crop.lonMax &&
    crop.latMin < crop.latMax &&
    // A crop can wrap past ±180 (lonMax > 180) but never span a full turn or more — that would be
    // a degenerate whole-world selection with no meaningful projection.
    crop.lonMax - crop.lonMin < 360 &&
    // 80° originally left no headroom for real countries: Greenland reaches 83.65°N, Canada
    // 83.23°N, Russia 81.25°N, Norway 80.66°N (all real Natural Earth extents) — widened to 84°
    // so the country-select mode (geo/world.ts's countriesToGeography) can select them. Antarctica
    // (reaches -90°) is excluded from the country dataset entirely (geo/worldCountries.ts) rather
    // than accommodated here.
    crop.latMin >= -84 &&
    crop.latMax <= 84
  );
}

export function buildProjection(crop: CropBBox): Projection {
  const midLat = (crop.latMin + crop.latMax) / 2;
  const cos = Math.max(0.1, Math.cos((midLat * Math.PI) / 180));
  const lonSpan = crop.lonMax - crop.lonMin;
  const latSpan = crop.latMax - crop.latMin;
  const rawW = lonSpan * cos;
  const rawH = latSpan;
  const longerSide = Math.max(rawW, rawH) || 1;
  const scale = TARGET_SPAN / longerSide;
  const w = rawW * scale;
  const h = rawH * scale;

  // Centre the (possibly non-square) projected rect inside a square-ish frame so short crops
  // don't hug one edge.
  const frameSpan = TARGET_SPAN;
  const offsetX = (frameSpan - w) / 2;
  const offsetY = (frameSpan - h) / 2;

  function project(lon: number, lat: number): readonly [number, number] {
    const x = (lon - crop.lonMin) * cos * scale + offsetX;
    const y = (crop.latMax - lat) * scale + offsetY; // board y grows south (north = 0)
    return [round2(x), round2(y)];
  }
  function unproject(x: number, y: number): readonly [number, number] {
    const lon = crop.lonMin + (x - offsetX) / (cos * scale);
    const lat = crop.latMax - (y - offsetY) / scale;
    return [lon, lat];
  }

  const baseView: BoardView = {
    x: round2(-MARGIN),
    y: round2(-MARGIN),
    w: round2(frameSpan + 2 * MARGIN),
    h: round2(frameSpan + 2 * MARGIN),
  };
  return { baseView, project, unproject };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
