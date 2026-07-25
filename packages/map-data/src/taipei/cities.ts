import type { CityId } from '@trm/shared';
import { asCityId } from '@trm/shared';
import type { CityDef, CityTier } from '../types';

const c = (
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  region: string,
  tier: CityTier = 'minor',
): CityDef => ({ id: asCityId(id), nameZh, nameEn, x, y, region, isIsland: false, tier });

/**
 * 38 stops across 臺北市, 新北市 and 基隆市 — the real Greater Taipei, at its real shape.
 *
 * Every coordinate is the stop's ACTUAL longitude/latitude pushed through the very projection
 * that produced `geography.ts`'s rings (the map builder's `geo/projection.ts` over the same crop),
 * so the board IS the region rather than a diagram of it: each stop falls inside its own city, the
 * coast runs where the coast runs, and the distances between stops are the real ones. Seven
 * coastal stops (Fisherman's Wharf, Bali, Shimen, Jinshan, Wanli, Gongliao, Linkou) are nudged at
 * most ~3 board units inland so their markers do not sit on the simplified shoreline; nothing
 * else is moved.
 *
 * Which stops: every metro interchange the network hangs off, then — because the region is far
 * more than its metro — the district towns that give the board its outer ring: the north coast
 * (Sanzhi → Keelung), the north-east cape (Ruifang, Shuangxi, Gongliao), the mountains (Pingxi,
 * Shiding, Pinglin, Wulai) and the Dahan valley (Shulin, Sanxia, Yingge). The dense infill
 * stations between the basin's interchanges are dropped, as issue #37 allows — at this scale
 * (~0.8 board units per km) Taipei Main to Ximen would be a single unit apart.
 *
 * `region` groups stops into six corridors — the random-events system boosts routes by region, so
 * the groups are kept comparable in size. `tier` drives the board's progressive label reveal.
 */
export const TAIPEI_CITIES: readonly CityDef[] = [
  // --- 淡水河口 Tamsui Estuary ---
  c('tp_tamsui', '淡水', 'Tamsui', 19.78, 20.24, '淡水河口', 'major'),
  c('tp_fishermanswharf', '漁人碼頭', "Fisherman's Wharf", 16.24, 17.67, '淡水河口'),
  c('tp_bali', '八里', 'Bali', 14.18, 23.51, '淡水河口', 'tertiary'),
  c('tp_guandu', '關渡', 'Guandu', 22.63, 26.18, '淡水河口', 'tertiary'),
  c('tp_beitou', '北投', 'Beitou', 26.65, 25.29, '淡水河口', 'secondary'),
  c('tp_luzhou', '蘆洲', 'Luzhou', 22.02, 31.01, '淡水河口', 'tertiary'),
  c('tp_linkou', '林口', 'Linkou', 10.33, 30.96, '淡水河口', 'secondary'),

  // --- 臺北市區 Taipei Urban ---
  c('tp_shilin', '士林', 'Shilin', 30.17, 30.61, '臺北市區', 'secondary'),
  c('tp_taipeimain', '臺北車站', 'Taipei Main Station', 29.01, 37.15, '臺北市區', 'major'),
  c('tp_taipei101', '臺北101', 'Taipei 101', 35.07, 39.23, '臺北市區', 'major'),
  c('tp_songshanairport', '松山機場', 'Songshan Airport', 33.45, 34.95, '臺北市區', 'secondary'),
  c('tp_gongguan', '公館', 'Gongguan', 31.23, 41.8, '臺北市區', 'secondary'),
  c('tp_sanchong', '三重', 'Sanchong', 24.97, 36.01, '臺北市區', 'secondary'),

  // --- 北海岸 North Coast ---
  c('tp_sanzhi', '三芝', 'Sanzhi', 26.91, 7.54, '北海岸', 'tertiary'),
  c('tp_shimen', '石門', 'Shimen', 35.32, 6.03, '北海岸'),
  c('tp_jinshan', '金山', 'Jinshan', 42.89, 14.57, '北海岸', 'secondary'),
  c('tp_wanli', '萬里', 'Wanli', 48.02, 19.53, '北海岸', 'tertiary'),
  c('tp_keelung', '基隆', 'Keelung', 57.5, 25.9, '北海岸', 'major'),

  // --- 基隆河谷 Keelung River Valley ---
  c('tp_neihu', '內湖', 'Neihu', 38.88, 32.06, '基隆河谷', 'secondary'),
  c('tp_nangang', '南港', 'Nangang', 40.45, 36.37, '基隆河谷', 'major'),
  c('tp_xizhi', '汐止', 'Xizhi', 47.57, 35, '基隆河谷', 'secondary'),
  c('tp_ruifang', '瑞芳', 'Ruifang', 66.44, 28.66, '基隆河谷', 'major'),
  c('tp_pingxi', '平溪', 'Pingxi', 57.33, 40.26, '基隆河谷', 'tertiary'),
  c('tp_shuangxi', '雙溪', 'Shuangxi', 73.52, 39.19, '基隆河谷', 'tertiary'),
  c('tp_gongliao', '貢寮', 'Gongliao', 78.41, 41.2, '基隆河谷'),

  // --- 新店溪谷 Xindian Valley ---
  c('tp_taipeizoo', '動物園', 'Taipei Zoo', 36.98, 44.14, '新店溪谷', 'tertiary'),
  c('tp_maokong', '貓空', 'Maokong', 38.33, 48.4, '新店溪谷'),
  c('tp_shiding', '石碇', 'Shiding', 47.07, 45.06, '新店溪谷'),
  c('tp_pinglin', '坪林', 'Pinglin', 53.82, 52.7, '新店溪谷'),
  c('tp_xindian', '新店', 'Xindian', 31.7, 49.83, '新店溪谷', 'major'),
  c('tp_wulai', '烏來', 'Wulai', 33.31, 63.1, '新店溪谷'),
  c('tp_zhonghe', '中和', 'Zhonghe', 26.65, 43.98, '新店溪谷', 'secondary'),

  // --- 大漢溪畔 Dahan Riverside ---
  c('tp_banqiao', '板橋', 'Banqiao', 22.19, 41.93, '大漢溪畔', 'major'),
  c('tp_xinzhuang', '新莊', 'Xinzhuang', 20.55, 38.82, '大漢溪畔', 'secondary'),
  c('tp_shulin', '樹林', 'Shulin', 16.66, 45.22, '大漢溪畔', 'tertiary'),
  c('tp_tucheng', '土城', 'Tucheng', 19.72, 47.73, '大漢溪畔', 'tertiary'),
  c('tp_sanxia', '三峽', 'Sanxia', 10.13, 53.15, '大漢溪畔', 'tertiary'),
  c('tp_yingge', '鶯歌', 'Yingge', 8.22, 50.29, '大漢溪畔', 'tertiary'),
];

export const TAIPEI_CITY_IDS: readonly CityId[] = TAIPEI_CITIES.map((x) => x.id);
