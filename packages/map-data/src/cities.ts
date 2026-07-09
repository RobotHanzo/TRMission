import type { CityId } from '@trm/shared';
import { asCityId } from '@trm/shared';
import type { CityDef } from './types';

const c = (
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  region: string,
  isIsland = false,
): CityDef => ({ id: asCityId(id), nameZh, nameEn, x, y, region, isIsland });

/** 36 cities — Taiwan map v4 (the tw2.1 network). The station graph is authored in the map
 *  editor and imported here; each mainland stop's editor position is mapped onto the bundled
 *  hand-drawn coast by a single affine fit (see docs/superpowers/specs/2026-07-10-taiwan-map-v4),
 *  the outlying islands + Matsu are pinned by hand onto their existing coastline blobs. Regions and
 *  zh names come from the editor; the 30 stations shared with the previous map keep their canonical
 *  English spellings. Coordinates are x 0 (west)…100 (east), y 0 (north)…100 (south). */
export const CITIES: readonly CityDef[] = [
  c('matsu', '馬祖', 'Matsu', 24, 7, '離島', true),
  c('kinmen', '金門', 'Kinmen', 4, 33, '離島', true),
  c('penghu', '澎湖', 'Penghu', 16, 50, '離島', true),
  c('greenisland', '綠島', 'Green Island', 65, 70, '東部', true),
  c('orchidisland', '蘭嶼', 'Orchid Island', 68, 85, '東部', true),
  c('taipei', '臺北', 'Taipei', 61.8, 12.8, '北部'),
  c('banqiao', '板橋', 'Banqiao', 59.3, 14.6, '北部'),
  c('taoyuan', '桃園', 'Taoyuan', 55.2, 14, '北部'),
  c('hsinchu', '新竹', 'Hsinchu', 50.8, 17.6, '北部'),
  c('zhunan', '竹南', 'Zhunan', 47.8, 19.5, '中部'),
  c('miaoli', '苗栗', 'Miaoli', 49.2, 27.1, '中部'),
  c('shalu', '沙鹿', 'Shalu', 41.4, 29, '中部'),
  c('taichung', '臺中', 'Taichung', 43.4, 35.7, '中部'),
  c('changhua', '彰化', 'Changhua', 35.6, 38.3, '中部'),
  c('nantou', '南投', 'Nantou', 48.4, 39.4, '中部'),
  c('douliu', '斗六', 'Douliu', 41, 45.8, '中部'),
  c('chiayi', '嘉義', 'Chiayi', 36.9, 53.8, '南部'),
  c('tainan', '臺南', 'Tainan', 31.8, 58.2, '南部'),
  c('kaohsiung', '高雄', 'Kaohsiung', 33.9, 68.8, '南部'),
  c('pingtung', '屏東', 'Pingtung', 39.7, 73.7, '南部'),
  c('chaozhou', '潮州', 'Chaozhou', 40.2, 78.1, '南部'),
  c('keelung', '基隆', 'Keelung', 66.5, 10.5, '北部'),
  c('hualien', '花蓮', 'Hualien', 61.6, 39.7, '東部'),
  c('yilan', '宜蘭', 'Yilan', 65, 22, '北部'),
  c('luodong', '羅東', 'Luodong', 66.3, 28, '北部'),
  c('taitung', '臺東', 'Taitung', 53.5, 65.8, '東部'),
  c('chishang', '池上', 'Chishang', 57.1, 56, '東部'),
  c('yuli', '玉里', 'Yuli', 59, 47.7, '東部'),
  c('alishan', '阿里山', 'Alishan', 45.5, 53.9, '南部'),
  c('jiji', '集集', 'JiJi', 46, 45.3, '中部'),
  c('huwei', '虎尾', 'Huwei', 35.7, 46, '中部'),
  c('guishan', '龜山島', 'Guishan Island', 73.7, 28, '北部', true),
  c('hengchun', '恆春', 'Hengchun', 43, 85.2, '南部'),
  c('liuqiu', '小琉球', 'Liuqiu', 33, 78, '南部', true),
  c('zuoying', '左營', 'Zuoying', 31.5, 63.6, '南部'),
  c('pingxi', '平溪', 'Pingxi', 64.8, 16.8, '北部'),
];

export const CITY_IDS: readonly CityId[] = CITIES.map((x) => x.id);
