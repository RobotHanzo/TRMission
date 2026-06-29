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

/** 39 cities — original Taiwan-geography graph inspired by real TRA / THSR / branch-line stations.
 *  At most one station per county outside the dense north metro and the eastern seaboard.
 *  Coordinates are an equal-scale geographic projection of each station's real lon/lat into the
 *  0–100 board (x: 0=west…100=east, y: 0=north…100=south), north-up, so the network registers
 *  against the Taiwan silhouette drawn in apps/web `geography.ts`. The six outlying islands keep
 *  their true bearing but have their (large) open-sea gaps compressed to stay on the board. */
export const CITIES: readonly CityDef[] = [
  c('keelung', '基隆', 'Keelung', 66.6, 10.5, 'North'),
  c('ruifang', '瑞芳', 'Ruifang', 68.2, 11, 'North'),
  c('taipei', '臺北', 'Taipei', 62.6, 12.5, 'North'),
  c('tamsui', '淡水', 'Tamsui', 59.9, 9.5, 'North'),
  c('banqiao', '板橋', 'Banqiao', 60.3, 13.5, 'North'),
  c('taoyuan', '桃園', 'Taoyuan', 56.7, 13.9, 'North'),
  c('zhongli', '中壢', 'Zhongli', 54.9, 14.9, 'North'),
  c('hsinchu', '新竹', 'Hsinchu', 49.3, 18.6, 'Northwest'),
  c('zhunan', '竹南', 'Zhunan', 47.1, 21.3, 'Northwest'),
  c('miaoli', '苗栗', 'Miaoli', 46, 24.2, 'Northwest'),
  c('fengyuan', '豐原', 'Fengyuan', 43.7, 32.1, 'Central-West'),
  c('taichung', '臺中', 'Taichung', 42.8, 34.8, 'Central-West'),
  c('changhua', '彰化', 'Changhua', 39.7, 36.2, 'Central-West'),
  c('nantou', '南投', 'Nantou', 43, 40.4, 'Interior'),
  c('sunmoonlake', '日月潭', 'Sun Moon Lake', 48.2, 41.6, 'Interior'),
  c('douliu', '斗六', 'Douliu', 39.7, 45.3, 'Yun-Chia-Nan'),
  c('chiayi', '嘉義', 'Chiayi', 37.7, 50.9, 'Yun-Chia-Nan'),
  c('alishan', '阿里山', 'Alishan', 45.5, 50.2, 'Interior'),
  c('tainan', '臺南', 'Tainan', 32.3, 62.9, 'Yun-Chia-Nan'),
  c('kaohsiung', '高雄', 'Kaohsiung', 34.3, 71.8, 'South'),
  c('pingtung', '屏東', 'Pingtung', 38.6, 70.8, 'South'),
  c('chaozhou', '潮州', 'Chaozhou', 39.7, 73.7, 'South'),
  c('hengchun', '恆春', 'Hengchun', 44.4, 86, 'South'),
  c('dawu', '大武', 'Dawu', 47.8, 78.4, 'South-link'),
  c('taitung', '臺東', 'Taitung', 53.1, 68.6, 'South-link'),
  c('zhiben', '知本', 'Zhiben', 51.3, 69.8, 'South-link'),
  c('chishang', '池上', 'Chishang', 54.7, 59.8, 'East-Rift'),
  c('yuli', '玉里', 'Yuli', 57.2, 54.6, 'East-Rift'),
  c('hualien', '花蓮', 'Hualien', 63.5, 38.7, 'East-Rift'),
  c('suao', '蘇澳', "Su'ao", 69.1, 23.7, 'Northeast'),
  c('luodong', '羅東', 'Luodong', 67.3, 21.5, 'Northeast'),
  c('yilan', '宜蘭', 'Yilan', 66.8, 19.6, 'Northeast'),
  c('toucheng', '頭城', 'Toucheng', 68.4, 17.1, 'Northeast'),
  c('penghu', '澎湖', 'Penghu', 16, 50, 'Islands', true),
  c('kinmen', '金門', 'Kinmen', 4, 33, 'Islands', true),
  c('matsu', '馬祖', 'Matsu', 24, 7, 'Islands', true),
  c('liuqiu', '小琉球', 'Liuqiu', 33, 78, 'Islands', true),
  c('greenisland', '綠島', 'Green Island', 65, 70, 'Islands', true),
  c('orchidisland', '蘭嶼', 'Orchid Island', 68, 85, 'Islands', true),
];

export const CITY_IDS: readonly CityId[] = CITIES.map((x) => x.id);
