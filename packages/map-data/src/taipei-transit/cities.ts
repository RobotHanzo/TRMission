import { asCityId } from '@trm/shared';
import type { CityDef, CityTier } from '../types';

const c = (
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  region: string,
  tier?: CityTier,
  isIsland = false,
): CityDef => ({
  id: asCityId(id),
  nameZh,
  nameEn,
  x,
  y,
  region,
  isIsland,
  ...(tier !== undefined ? { tier } : {}),
});

/**
 * 46 stops, exactly as 嶼翼 placed them in the builder draft this map was adopted from — the
 * Taipei basin's rail-transit web plus the corridors out of it: the north coast (三芝→萬里), the
 * Keelung harbour towns, the 平溪/雙溪 valley to 福隆, the Xindian/Dahan valleys, and the two
 * gateways past the map's edges (桃園 in the west, 大溪/礁溪 on the Yilan side). Coordinates are
 * the draft's own hand placement (not a projection); only ids and regions were normalised on
 * adoption. `region` follows the real administrative division — 臺北市/新北市/基隆市/桃園市/宜蘭縣
 * — which the random-events system uses to pick event areas. A missing `tier` reads as `minor`.
 */
export const TAIPEI_TRANSIT_CITIES: readonly CityDef[] = [
  c('tt_taipei', '台北', 'Taipei', 49.7, 23.5, '臺北市', 'major'),
  c('tt_shilin', '士林', 'Shilin', 49.2, 19.9, '臺北市', 'tertiary'),
  c('tt_nangang', '南港', 'Nangang', 57.2, 22.3, '臺北市', 'major'),
  c('tt_daan', '大安', "Da'an", 53.9, 25.7, '臺北市', 'secondary'),
  c('tt_beitou', '北投', 'Beitou', 46.6, 16.4, '臺北市', 'secondary'),
  c('tt_tamsui', '淡水', 'Tamsui', 41.7, 13.2, '新北市', 'major'),
  c('tt_bali', '八里', 'Bali', 37, 13.1, '新北市', 'secondary'),
  c('tt_cksmemorial', '中正紀念堂', 'Chiang Kai-shek Memorial Hall', 50.4, 26.5, '臺北市', 'major'),
  c('tt_keelung', '基隆', 'Keelung', 65.9, 14.1, '基隆市', 'major'),
  c('tt_qidu', '七堵', 'Qidu', 64, 20.5, '基隆市', 'secondary'),
  c('tt_ruifang', '瑞芳', 'Ruifang', 73.5, 19, '新北市', 'secondary'),
  c('tt_neihu', '內湖', 'Neihu', 55.2, 19.4, '臺北市', 'secondary'),
  c('tt_sanchong', '三重', 'Sanchong', 45.2, 23.3, '新北市', 'tertiary'),
  c('tt_banqiao', '板橋', 'Banqiao', 45, 28.2, '新北市', 'major'),
  c('tt_xindian', '新店', 'Xindian', 53.3, 35.7, '新北市', 'secondary'),
  c('tt_dapinglin', '大坪林', 'Dapinglin', 53.5, 32.5, '新北市', 'secondary'),
  c('tt_zhonghe', '中和', 'Zhonghe', 48.9, 31, '新北市', 'secondary'),
  c('tt_tucheng', '土城', 'Tucheng', 43.2, 32.1, '新北市', 'secondary'),
  c('tt_sanxia', '三峽', 'Sanxia', 37.5, 36.1, '新北市', 'secondary'),
  c('tt_yingge', '鶯歌', 'Yingge', 33.9, 31.3, '新北市', 'secondary'),
  c('tt_shulin', '樹林', 'Shulin', 40.3, 29.2, '新北市', 'secondary'),
  c('tt_xinzhuang', '新莊', 'Xinzhuang', 42.3, 24.8, '新北市', 'secondary'),
  c('tt_linkou', '林口', 'Linkou', 33.6, 19.9, '新北市', 'secondary'),
  c('tt_muzha', '木柵', 'Muzha', 57.6, 27.2, '臺北市', 'tertiary'),
  c('tt_ankeng', '安坑', 'Ankeng', 46.5, 36.6, '新北市', 'tertiary'),
  c('tt_wulai', '烏來', 'Wulai', 51.8, 44.5, '新北市'),
  c('tt_luzhou', '蘆洲', 'Luzhou', 43.9, 20.2, '新北市', 'tertiary'),
  c('tt_songshan', '松山', 'Songshan', 53.5, 22.8, '臺北市', 'secondary'),
  c('tt_shiding', '石碇', 'Shiding', 63.5, 27.2, '新北市', 'tertiary'),
  c('tt_badouzi', '八斗子', 'Badouzi', 69.6, 15.4, '基隆市', 'tertiary'),
  c('tt_anle', '安樂', 'Anle', 61.7, 17.8, '基隆市'),
  c('tt_pingxi', '平溪', 'Pingxi', 70.6, 24.1, '新北市', 'tertiary'),
  c('tt_shuangxi', '雙溪', 'Shuangxi', 78.9, 24, '新北市', 'tertiary'),
  c('tt_fulong', '福隆', 'Fulong', 84.7, 26.3, '新北市'),
  c('tt_fishermanswharf', '漁人碼頭', "Fisherman's Wharf", 37.9, 9.7, '新北市', 'tertiary'),
  c('tt_danhai', '淡海', 'Danhai', 41, 8.6, '新北市', 'secondary'),
  c('tt_sanzhi', '三芝', 'Sanzhi', 43.4, 4.8, '新北市', 'tertiary'),
  c('tt_shimen', '石門', 'Shimen', 50.8, 1.3, '新北市'),
  c('tt_jinshan', '金山', 'Jinshan', 56.8, 6.2, '新北市', 'tertiary'),
  c('tt_wanli', '萬里', 'Wanli', 61.7, 10.8, '新北市'),
  c('tt_yangmingshan', '陽明山', 'Yangmingshan', 51.4, 10.8, '臺北市'),
  c('tt_pinglin', '坪林', 'Pinglin', 65.2, 34.5, '新北市', 'tertiary'),
  c('tt_daxi', '大溪', 'Daxi', 80.3, 33.8, '宜蘭縣', 'tertiary'),
  c('tt_jiaoxi', '礁溪', 'Jiaoxi', 69.2, 45.1, '宜蘭縣', 'tertiary'),
  c('tt_keelungislet', '基隆嶼', 'Keelung Islet', 72.3, 7.3, '基隆市', 'secondary', true),
  c('tt_taoyuan', '桃園', 'Taoyuan', 29.4, 27.4, '桃園市', 'major'),
];
