import type { CityId } from '@trm/shared';
import { asCityId } from '@trm/shared';
import type { CityDef, CityTier } from './types';

const c = (
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  region: string,
  isIsland = false,
  tier: CityTier = 'minor',
): CityDef => ({ id: asCityId(id), nameZh, nameEn, x, y, region, isIsland, tier });

/** 36 cities — Taiwan map v4 (the tw2.1 network). The station graph is authored in the map
 *  editor and imported here; each mainland stop's editor position is mapped onto the bundled
 *  hand-drawn coast by a single affine fit (see docs/superpowers/specs/2026-07-10-taiwan-map-v4),
 *  the outlying islands + Matsu are pinned by hand onto their existing coastline blobs. Regions and
 *  zh names come from the editor; the 30 stations shared with the previous map keep their canonical
 *  English spellings. Coordinates are x 0 (west)…100 (east), y 0 (north)…100 (south). `tier`
 *  drives the live board's progressive label reveal (game/content.ts's cityTier +
 *  game/lod.ts's zoomBucket) — matches the id sets that were previously hardcoded there. */
export const CITIES: readonly CityDef[] = [
  c('matsu', '馬祖', 'Matsu', 24, 7, '離島', true),
  c('kinmen', '金門', 'Kinmen', 4, 33, '離島', true),
  c('penghu', '澎湖', 'Penghu', 16, 50, '離島', true),
  c('greenisland', '綠島', 'Green Island', 65, 70, '東部', true),
  c('orchidisland', '蘭嶼', 'Orchid Island', 68, 85, '東部', true),
  c('taipei', '臺北', 'Taipei', 61.8, 12.8, '北部', false, 'major'),
  c('banqiao', '板橋', 'Banqiao', 59.3, 14.6, '北部', false, 'tertiary'),
  c('taoyuan', '桃園', 'Taoyuan', 55.2, 14, '北部', false, 'secondary'),
  c('hsinchu', '新竹', 'Hsinchu', 49.6, 16, '北部', false, 'major'),
  c('zhunan', '竹南', 'Zhunan', 46.1, 20.4, '中部', false, 'tertiary'),
  c('miaoli', '苗栗', 'Miaoli', 49.2, 27.1, '中部', false, 'secondary'),
  c('shalu', '沙鹿', 'Shalu', 41.4, 29.2, '中部', false, 'tertiary'),
  c('taichung', '臺中', 'Taichung', 46.2, 34.1, '中部', false, 'major'),
  c('changhua', '彰化', 'Changhua', 39.1, 34.6, '中部', false, 'secondary'),
  c('nantou', '南投', 'Nantou', 48.4, 39.4, '中部', false, 'secondary'),
  c('douliu', '斗六', 'Douliu', 41.3, 44.9, '中部', false, 'secondary'),
  c('chiayi', '嘉義', 'Chiayi', 39.3, 50.8, '南部', false, 'major'),
  c('tainan', '臺南', 'Tainan', 31.8, 58.2, '南部', false, 'major'),
  c('kaohsiung', '高雄', 'Kaohsiung', 33.9, 68.8, '南部', false, 'major'),
  c('pingtung', '屏東', 'Pingtung', 40, 68.6, '南部', false, 'secondary'),
  c('chaozhou', '潮州', 'Chaozhou', 40.2, 78.1, '南部', false, 'tertiary'),
  c('keelung', '基隆', 'Keelung', 66.5, 10.5, '北部', false, 'secondary'),
  c('hualien', '花蓮', 'Hualien', 66.3, 40.8, '東部', false, 'major'),
  c('yilan', '宜蘭', 'Yilan', 70.7, 21.1, '北部', false, 'major'),
  c('luodong', '羅東', 'Luodong', 70.3, 28.9, '北部', false, 'secondary'),
  c('taitung', '臺東', 'Taitung', 57.5, 67.1, '東部', false, 'major'),
  c('chishang', '池上', 'Chishang', 57.1, 56, '東部'),
  c('yuli', '玉里', 'Yuli', 60.7, 48.6, '東部', false, 'secondary'),
  c('alishan', '阿里山', 'Alishan', 46.8, 50.3, '南部', false, 'secondary'),
  c('jiji', '集集', 'JiJi', 48.4, 44.6, '中部'),
  c('huwei', '虎尾', 'Huwei', 35.1, 45, '中部', false, 'tertiary'),
  c('guishan', '龜山島', 'Guishan Island', 77.3, 23, '北部', true),
  c('hengchun', '恆春', 'Hengchun', 44.2, 87.3, '南部', false, 'major'),
  c('liuqiu', '小琉球', 'Liuqiu', 33, 78, '南部', true),
  c('zuoying', '左營', 'Zuoying', 31.5, 63.6, '南部', false, 'tertiary'),
  c('pingxi', '平溪', 'Pingxi', 64.8, 16.8, '北部'),
];

export const CITY_IDS: readonly CityId[] = CITIES.map((x) => x.id);
