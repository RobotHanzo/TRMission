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
 * 44 stops for the Greater Taipei map — the metro network as a board, not as a timetable.
 *
 * Stops are chosen the way a transit diagram chooses them: every interchange and every branch
 * terminus survives, the dense runs of infill stations between them are dropped (issue #37
 * explicitly allows this), and a handful of non-metro nodes that the network is visibly growing
 * towards are treated as stops — Keelung and Xizhi on the planned eastern corridor, Sanxia/Yingge
 * on the Sanying line, Taoyuan/Huanbei on the airport line's far end, Bali across the estuary on
 * the ferry, and Maokong on the gondola.
 *
 * Positions are geographic in arrangement but NOT to scale: the Taipei basin is opened up so the
 * core interchanges read at a glance, and the long western (airport) and eastern (Keelung) arms
 * are foreshortened — the standard metro-diagram distortion. Coordinates are x 0 (west)…100
 * (east), y 0 (north)…100 (south), matching the hand-drawn coast in `geography.ts`. `region`
 * groups stops into six corridors (the random-events system boosts routes by region, so the
 * groups are kept comparable in size); `tier` drives the board's progressive label reveal.
 */
export const TAIPEI_CITIES: readonly CityDef[] = [
  // --- 淡水河谷 Tamsui Valley ---
  c('tp_tamsui', '淡水', 'Tamsui', 34, 17, '淡水河谷', 'major'),
  c('tp_fishermanswharf', '漁人碼頭', "Fisherman's Wharf", 29, 9, '淡水河谷', 'tertiary'),
  c('tp_bali', '八里', 'Bali', 18, 22, '淡水河谷', 'tertiary'),
  c('tp_guandu', '關渡', 'Guandu', 41, 22, '淡水河谷', 'secondary'),
  c('tp_beitou', '北投', 'Beitou', 47, 18, '淡水河谷', 'secondary'),
  c('tp_shilin', '士林', 'Shilin', 51, 25, '淡水河谷', 'secondary'),
  c('tp_luzhou', '蘆洲', 'Luzhou', 37, 29, '淡水河谷', 'tertiary'),
  c('tp_sanchong', '三重', 'Sanchong', 42, 33, '淡水河谷', 'secondary'),

  // --- 臺北核心 Taipei Core ---
  c('tp_zhongshan', '中山', 'Zhongshan', 50, 32, '臺北核心', 'secondary'),
  c('tp_taipeimain', '臺北車站', 'Taipei Main Station', 50, 38, '臺北核心', 'major'),
  c('tp_ximen', '西門', 'Ximen', 46, 42, '臺北核心', 'tertiary'),
  c('tp_longshan', '龍山寺', 'Longshan Temple', 41, 45, '臺北核心', 'tertiary'),
  c('tp_cksmemorial', '中正紀念堂', 'CKS Memorial Hall', 51, 44, '臺北核心', 'tertiary'),
  c('tp_dongmen', '東門', 'Dongmen', 57, 44, '臺北核心', 'tertiary'),
  c('tp_guting', '古亭', 'Guting', 52, 50, '臺北核心', 'tertiary'),
  c('tp_daan', '大安', 'Daan', 62, 48, '臺北核心', 'secondary'),
  c('tp_zhongxiaofuxing', '忠孝復興', 'Zhongxiao Fuxing', 62, 40, '臺北核心', 'secondary'),
  c('tp_nanjingfuxing', '南京復興', 'Nanjing Fuxing', 60, 34, '臺北核心', 'tertiary'),

  // --- 東區走廊 Eastern Corridor ---
  c('tp_songshanairport', '松山機場', 'Songshan Airport', 58, 30, '東區走廊', 'secondary'),
  c('tp_dazhi', '大直', 'Dazhi', 57, 24, '東區走廊', 'tertiary'),
  c('tp_neihu', '內湖', 'Neihu', 72, 26, '東區走廊', 'secondary'),
  c('tp_songshan', '松山', 'Songshan', 70, 35, '東區走廊', 'secondary'),
  c('tp_cityhall', '市政府', 'Taipei City Hall', 70, 42, '東區走廊', 'secondary'),
  c('tp_taipei101', '臺北101', 'Taipei 101', 70, 48, '東區走廊', 'major'),
  c('tp_nangang', '南港', 'Nangang', 79, 33, '東區走廊', 'major'),
  c('tp_xizhi', '汐止', 'Xizhi', 88, 28, '東區走廊', 'secondary'),
  c('tp_keelung', '基隆', 'Keelung', 95, 17, '東區走廊', 'major'),

  // --- 南區丘陵 Southern Hills ---
  c('tp_gongguan', '公館', 'Gongguan', 54, 56, '南區丘陵', 'secondary'),
  c('tp_taipeizoo', '動物園', 'Taipei Zoo', 66, 58, '南區丘陵', 'secondary'),
  c('tp_maokong', '貓空', 'Maokong', 72, 65, '南區丘陵', 'tertiary'),
  c('tp_dapinglin', '大坪林', 'Dapinglin', 57, 63, '南區丘陵', 'tertiary'),
  c('tp_xindian', '新店', 'Xindian', 55, 70, '南區丘陵', 'major'),
  c('tp_zhonghe', '中和', 'Zhonghe', 44, 55, '南區丘陵', 'secondary'),

  // --- 西區市鎮 Western Towns ---
  c('tp_banqiao', '板橋', 'Banqiao', 34, 48, '西區市鎮', 'major'),
  c('tp_tucheng', '土城', 'Tucheng', 30, 57, '西區市鎮', 'tertiary'),
  c('tp_sanxia', '三峽', 'Sanxia', 22, 66, '西區市鎮', 'secondary'),
  c('tp_yingge', '鶯歌', 'Yingge', 16, 60, '西區市鎮', 'secondary'),
  c('tp_xinzhuang', '新莊', 'Xinzhuang', 33, 39, '西區市鎮', 'secondary'),
  c('tp_huilong', '迴龍', 'Huilong', 26, 43, '西區市鎮', 'tertiary'),
  c('tp_linkou', '林口', 'Linkou', 22, 31, '西區市鎮', 'secondary'),

  // --- 桃園臺地 Taoyuan Terrace ---
  c('tp_airport', '桃園機場', 'Taoyuan Airport', 8, 26, '桃園臺地', 'major'),
  c('tp_thsrtaoyuan', '高鐵桃園', 'THSR Taoyuan', 6, 40, '桃園臺地', 'secondary'),
  c('tp_taoyuan', '桃園', 'Taoyuan', 14, 52, '桃園臺地', 'major'),
  c('tp_huanbei', '環北', 'Huanbei', 5, 53, '桃園臺地', 'tertiary'),
];

export const TAIPEI_CITY_IDS: readonly CityId[] = TAIPEI_CITIES.map((x) => x.id);
