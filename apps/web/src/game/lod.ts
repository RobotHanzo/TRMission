// Cartographic level-of-detail for city *labels*: which labels appear at which zoom.
//
// This is purely presentational and lives in the web layer on purpose — it must never
// touch @trm/map-data, since any content change reshuffles CONTENT_HASH and breaks
// replays. Node dots always render at every zoom; only the text labels are tiered so the
// dense corridors (north metro, central plain) don't all pop in at once.

export type ZoomBucket = 'far' | 'regional' | 'district' | 'local';

/**
 * Live zoom → level-of-detail bucket. Boundaries are tuned so the home view
 * (`initialScale` 1.9) sits at `district` (majors + secondary + tertiary), and a deliberate
 * zoom-in past 2.4 is needed to reveal every minor station.
 */
export const zoomBucket = (scale: number): ZoomBucket =>
  scale < 1.25 ? 'far' : scale < 1.7 ? 'regional' : scale < 2.4 ? 'district' : 'local';

export type CityTier = 'major' | 'secondary' | 'tertiary' | 'minor';

// Tier 1 — hub + landmark cities whose labels survive the most zoomed-out view. Some
// (花蓮 / 恆春 / 臺東) are low-degree endpoints but cartographically prominent, so this is a
// hand-picked set rather than a graph-degree ranking.
export const MAJOR_CITIES: ReadonlySet<string> = new Set([
  'taipei',
  'hsinchu',
  'taichung',
  'chiayi',
  'tainan',
  'kaohsiung',
  'hualien',
  'taitung',
  'yilan',
  'hengchun',
]);

// Tier 2 — prominent metros, county seats, and signature landmarks; revealed at `regional`.
export const SECONDARY_CITIES: ReadonlySet<string> = new Set([
  'keelung', // 基隆 — northern port city
  'taoyuan', // 桃園 — metropolis
  'miaoli', // 苗栗 — county seat
  'changhua', // 彰化 — county seat / central junction
  'douliu', // 斗六 — Yunlin county seat
  'pingtung', // 屏東 — county seat
  'sunmoonlake', // 日月潭 — signature landmark
  'alishan', // 阿里山 — mountain-railway landmark
  'yuli', // 玉里 — Rift Valley hub
  'luodong', // 羅東 — largest Yilan town
]);

// Tier 3 — district towns and line junctions; revealed at `district` (the home view).
export const TERTIARY_CITIES: ReadonlySet<string> = new Set([
  'zhongli', // 中壢
  'zhunan', // 竹南
  'fengyuan', // 豐原
  'nantou', // 南投
  'chaozhou', // 潮州
  'suao', // 蘇澳
]);
// Everything else (淡水, 板橋, 瑞芳, 大武, 知本, 池上, 頭城, …) is `minor` and only
// appears at `local`. Islands always show their label regardless of tier (handled in CSS).

export const cityTier = (id: string): CityTier =>
  MAJOR_CITIES.has(id)
    ? 'major'
    : SECONDARY_CITIES.has(id)
      ? 'secondary'
      : TERTIARY_CITIES.has(id)
        ? 'tertiary'
        : 'minor';
