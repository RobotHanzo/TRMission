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
 *  At most one station per county outside the dense north metro and the eastern seaboard. */
export const CITIES: readonly CityDef[] = [
  c('keelung', '基隆', 'Keelung', 63, 5, 'North'),
  c('ruifang', '瑞芳', 'Ruifang', 66, 8, 'North'),
  c('taipei', '臺北', 'Taipei', 58, 9, 'North'),
  c('tamsui', '淡水', 'Tamsui', 53, 6, 'North'),
  c('banqiao', '板橋', 'Banqiao', 56, 11, 'North'),
  c('taoyuan', '桃園', 'Taoyuan', 51, 14, 'North'),
  c('zhongli', '中壢', 'Zhongli', 48, 17, 'North'),
  c('hsinchu', '新竹', 'Hsinchu', 43, 22, 'Northwest'),
  c('zhunan', '竹南', 'Zhunan', 42, 25, 'Northwest'),
  c('miaoli', '苗栗', 'Miaoli', 41, 29, 'Northwest'),
  c('fengyuan', '豐原', 'Fengyuan', 43, 34, 'Central-West'),
  c('taichung', '臺中', 'Taichung', 41, 38, 'Central-West'),
  c('changhua', '彰化', 'Changhua', 39, 41, 'Central-West'),
  c('nantou', '南投', 'Nantou', 47, 43, 'Interior'),
  c('sunmoonlake', '日月潭', 'Sun Moon Lake', 51, 46, 'Interior'),
  c('douliu', '斗六', 'Douliu', 40, 49, 'Yun-Chia-Nan'),
  c('chiayi', '嘉義', 'Chiayi', 38, 53, 'Yun-Chia-Nan'),
  c('alishan', '阿里山', 'Alishan', 48, 55, 'Interior'),
  c('tainan', '臺南', 'Tainan', 36, 61, 'Yun-Chia-Nan'),
  c('kaohsiung', '高雄', 'Kaohsiung', 38, 66, 'South'),
  c('pingtung', '屏東', 'Pingtung', 44, 66, 'South'),
  c('chaozhou', '潮州', 'Chaozhou', 45, 70, 'South'),
  c('hengchun', '恆春', 'Hengchun', 48, 86, 'South'),
  c('dawu', '大武', 'Dawu', 53, 80, 'South-link'),
  c('taitung', '臺東', 'Taitung', 58, 76, 'South-link'),
  c('zhiben', '知本', 'Zhiben', 56, 78, 'South-link'),
  c('chishang', '池上', 'Chishang', 61, 67, 'East-Rift'),
  c('yuli', '玉里', 'Yuli', 64, 61, 'East-Rift'),
  c('hualien', '花蓮', 'Hualien', 68, 49, 'East-Rift'),
  c('suao', '蘇澳', "Su'ao", 65, 34, 'Northeast'),
  c('luodong', '羅東', 'Luodong', 63, 31, 'Northeast'),
  c('yilan', '宜蘭', 'Yilan', 62, 28, 'Northeast'),
  c('toucheng', '頭城', 'Toucheng', 63, 24, 'Northeast'),
  c('penghu', '澎湖', 'Penghu', 20, 56, 'Islands', true),
  c('kinmen', '金門', 'Kinmen', 5, 48, 'Islands', true),
  c('matsu', '馬祖', 'Matsu', 22, 10, 'Islands', true),
  c('liuqiu', '小琉球', 'Liuqiu', 31, 69, 'Islands', true),
  c('greenisland', '綠島', 'Green Island', 70, 78, 'Islands', true),
  c('orchidisland', '蘭嶼', 'Orchid Island', 73, 88, 'Islands', true),
];

export const CITY_IDS: readonly CityId[] = CITIES.map((x) => x.id);
