import { asCityId, asTicketId } from '@trm/shared';
import type { GameContent, MapMeta, CityDef, RouteDef, TicketDef } from '../types';
import { buildRoute, type Row } from '../routes';

/**
 * Frozen snapshot of map content **version 3** — the 39-city one-station-per-county Taiwan graph
 * as it stood just before v4 (the tw2.1 network) replaced it. Persisted/in-flight games created
 * against v3 carry its `contentHash`; the registry rebuilds their exact board from this snapshot,
 * so the v4 content change never breaks their recovery/replay (ADR A6/A13).
 *
 * Every table is captured here as a full immutable literal (v4 diverges in cities, routes AND
 * tickets), so this snapshot is independent of the live tables. The pinned v3 hash assertion in
 * `test/versions.spec.ts` is the tripwire that this copy stayed byte-exact.
 */

const c = (
  id: string,
  nameZh: string,
  nameEn: string,
  x: number,
  y: number,
  region: string,
  isIsland = false,
): CityDef => ({ id: asCityId(id), nameZh, nameEn, x, y, region, isIsland });

export const CITIES_V3: readonly CityDef[] = [
  c('keelung', '基隆', 'Keelung', 65.6, 9.8, 'North'),
  c('ruifang', '瑞芳', 'Ruifang', 70.2, 12.2, 'North'),
  c('taipei', '臺北', 'Taipei', 62.8, 12.8, 'North'),
  c('tamsui', '淡水', 'Tamsui', 57.6, 9.8, 'North'),
  c('banqiao', '板橋', 'Banqiao', 60.2, 16, 'North'),
  c('taoyuan', '桃園', 'Taoyuan', 56.8, 13.6, 'North'),
  c('zhongli', '中壢', 'Zhongli', 53, 16.2, 'North'),
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
  c('suao', '蘇澳', "Su'ao", 71, 24.4, 'Northeast'),
  c('luodong', '羅東', 'Luodong', 69.2, 22, 'Northeast'),
  c('yilan', '宜蘭', 'Yilan', 66.4, 19.4, 'Northeast'),
  c('toucheng', '頭城', 'Toucheng', 69.4, 16.6, 'Northeast'),
  c('penghu', '澎湖', 'Penghu', 16, 50, 'Islands', true),
  c('kinmen', '金門', 'Kinmen', 4, 33, 'Islands', true),
  c('matsu', '馬祖', 'Matsu', 24, 7, 'Islands', true),
  c('liuqiu', '小琉球', 'Liuqiu', 33, 78, 'Islands', true),
  c('greenisland', '綠島', 'Green Island', 65, 70, 'Islands', true),
  c('orchidisland', '蘭嶼', 'Orchid Island', 68, 85, 'Islands', true),
];

const V3_ROWS: readonly Row[] = [
  ['R1', 'keelung', 'ruifang', 'YELLOW', 1, ''],
  ['R2', 'keelung', 'taipei', 'BLACK', 2, ''],
  ['R3', 'ruifang', 'taipei', 'ORANGE', 1, ''],
  ['R4', 'taipei', 'tamsui', 'BLUE', 1, ''],
  ['R5', 'tamsui', 'taoyuan', 'WHITE', 3, ''],
  ['R6', 'taipei', 'banqiao', 'WHITE', 1, 'D-A'],
  ['R7', 'taipei', 'banqiao', 'RED', 1, 'D-A'],
  ['R8', 'banqiao', 'taoyuan', 'GREEN', 2, 'D-B'],
  ['R9', 'banqiao', 'taoyuan', 'ORANGE', 2, 'D-B'],
  ['R10', 'taoyuan', 'zhongli', 'YELLOW', 1, 'D-C'],
  ['R11', 'taoyuan', 'zhongli', 'PURPLE', 1, 'D-C'],
  ['R12', 'zhongli', 'hsinchu', 'BLUE', 2, 'D-D'],
  ['R13', 'zhongli', 'hsinchu', 'RED', 2, 'D-D'],
  ['R14', 'taoyuan', 'hsinchu', 'BLACK', 3, ''],
  ['R15', 'zhongli', 'miaoli', 'ORANGE', 3, ''],
  ['R16', 'hsinchu', 'zhunan', 'GRAY', 1, ''],
  ['R17', 'hsinchu', 'miaoli', 'GREEN', 2, ''],
  ['R18', 'taipei', 'yilan', 'GRAY', 4, 'T'],
  ['R19', 'zhunan', 'miaoli', 'RED', 1, ''],
  ['R20', 'miaoli', 'fengyuan', 'BLUE', 2, 'T'],
  ['R21', 'fengyuan', 'taichung', 'BLACK', 1, ''],
  ['R22', 'miaoli', 'taichung', 'WHITE', 3, ''],
  ['R23', 'taichung', 'changhua', 'ORANGE', 1, 'D-E'],
  ['R24', 'taichung', 'changhua', 'GREEN', 1, 'D-E'],
  ['R38', 'changhua', 'douliu', 'PURPLE', 3, ''],
  ['R39', 'douliu', 'chiayi', 'GREEN', 2, 'D-G'],
  ['R40', 'douliu', 'chiayi', 'WHITE', 2, 'D-G'],
  ['R41', 'taichung', 'nantou', 'WHITE', 2, ''],
  ['R44', 'nantou', 'sunmoonlake', 'RED', 2, 'T'],
  ['R46', 'taichung', 'sunmoonlake', 'BLUE', 4, 'T'],
  ['R47', 'nantou', 'alishan', 'WHITE', 3, 'T'],
  ['R48', 'chiayi', 'alishan', 'BLUE', 3, 'T'],
  ['R50', 'sunmoonlake', 'hualien', 'GRAY', 8, 'T'],
  ['R55', 'chiayi', 'tainan', 'GREEN', 3, ''],
  ['R56', 'tainan', 'kaohsiung', 'RED', 2, 'D-I'],
  ['R57', 'tainan', 'kaohsiung', 'WHITE', 2, 'D-I'],
  ['R58', 'kaohsiung', 'pingtung', 'YELLOW', 2, 'D-J'],
  ['R59', 'kaohsiung', 'pingtung', 'BLUE', 2, 'D-J'],
  ['R60', 'tainan', 'pingtung', 'PURPLE', 3, ''],
  ['R61', 'pingtung', 'chaozhou', 'BLUE', 1, ''],
  ['R62', 'kaohsiung', 'chaozhou', 'GREEN', 2, ''],
  ['R94', 'chaozhou', 'hengchun', 'ORANGE', 6, ''], // 潮州–恆春: reconnects the Hengchun cape after 枋寮 was removed
  ['R66', 'dawu', 'zhiben', 'GREEN', 2, 'T'],
  ['R67', 'zhiben', 'taitung', 'RED', 1, ''],
  ['R69', 'hengchun', 'dawu', 'YELLOW', 3, 'T'],
  ['R70', 'hengchun', 'taitung', 'GRAY', 6, ''],
  ['R71', 'taitung', 'chishang', 'WHITE', 2, ''],
  ['R72', 'chishang', 'yuli', 'ORANGE', 1, ''],
  ['R73', 'taitung', 'yuli', 'BLACK', 3, ''],
  ['R74', 'yuli', 'hualien', 'PURPLE', 3, ''],
  ['R75', 'hualien', 'suao', 'BLUE', 4, 'T'],
  ['R76', 'suao', 'luodong', 'BLACK', 1, ''],
  ['R77', 'suao', 'yilan', 'PURPLE', 2, 'T'],
  ['R78', 'luodong', 'yilan', 'GREEN', 1, ''],
  ['R79', 'yilan', 'toucheng', 'YELLOW', 1, ''],
  ['R80', 'toucheng', 'ruifang', 'RED', 3, 'T'],
  ['R81', 'keelung', 'matsu', 'GRAY', 6, 'F2'],
  ['R82', 'chiayi', 'penghu', 'GRAY', 3, 'F1'],
  ['R83', 'kaohsiung', 'penghu', 'GRAY', 4, 'F2'],
  ['R84', 'penghu', 'kinmen', 'GRAY', 4, 'F2'],
  ['R85', 'kaohsiung', 'kinmen', 'GRAY', 6, 'F3'],
  ['R87', 'kaohsiung', 'liuqiu', 'GRAY', 3, 'F1'],
  ['R88', 'taitung', 'greenisland', 'GRAY', 2, 'F1'],
  ['R89', 'taitung', 'orchidisland', 'GRAY', 3, 'F2'],
  ['R90', 'greenisland', 'orchidisland', 'GRAY', 2, 'F1'],
  // Cross-island mountain railways — original tunnels spanning the central range so the
  // east is reachable from several latitudes (north / central / south), not just one spine.
  ['R91', 'taoyuan', 'yilan', 'PURPLE', 6, 'T'], // 北橫: a second northern crossing
  ['R92', 'nantou', 'yuli', 'GRAY', 8, 'T'], // 中橫: the deep central crossing to the Rift Valley
  ['R93', 'alishan', 'chishang', 'YELLOW', 6, 'T'], // 南橫: the southern high-mountain crossing
];
const V3_ROUTES: readonly RouteDef[] = V3_ROWS.map(buildRoute);

type TRow = [string, string, string, number];
const longRows: readonly TRow[] = [
  ['L1', 'keelung', 'kaohsiung', 22],
  ['L2', 'taipei', 'taitung', 16],
  ['L3', 'tamsui', 'hengchun', 21],
  ['L4', 'matsu', 'orchidisland', 25],
  ['L5', 'hualien', 'tainan', 17],
  ['L6', 'kinmen', 'yilan', 24],
];
const shortRows: readonly TRow[] = [
  ['S1', 'keelung', 'hsinchu', 8],
  ['S2', 'banqiao', 'hsinchu', 5],
  ['S3', 'taipei', 'suao', 6],
  ['S4', 'ruifang', 'yilan', 5],
  ['S5', 'taoyuan', 'miaoli', 4],
  ['S6', 'taipei', 'taichung', 9],
  ['S7', 'tamsui', 'hsinchu', 6],
  ['S8', 'hsinchu', 'changhua', 6],
  ['S9', 'taichung', 'chiayi', 6],
  ['S11', 'taichung', 'sunmoonlake', 5],
  ['S12', 'changhua', 'alishan', 7],
  ['S13', 'taichung', 'yuli', 12],
  ['S14', 'chiayi', 'chishang', 10],
  ['S15', 'zhunan', 'changhua', 5],
  ['S16', 'chiayi', 'kaohsiung', 5],
  ['S17', 'tainan', 'pingtung', 4],
  ['S18', 'douliu', 'tainan', 4],
  ['S20', 'changhua', 'tainan', 7],
  ['S21', 'nantou', 'tainan', 6],
  ['S22', 'pingtung', 'taitung', 11],
  ['S23', 'kaohsiung', 'hengchun', 8],
  ['S25', 'taitung', 'hualien', 6],
  ['S26', 'dawu', 'chishang', 6],
  ['S27', 'hualien', 'yilan', 6],
  ['S28', 'yuli', 'suao', 8],
  ['S29', 'taitung', 'yuli', 4],
  ['S30', 'hualien', 'luodong', 6],
  ['S31', 'taichung', 'hualien', 13],
  ['S32', 'nantou', 'yuli', 13],
  ['S33', 'hsinchu', 'tainan', 12],
  ['S34', 'taichung', 'kaohsiung', 9],
  ['S35', 'kaohsiung', 'penghu', 5],
  ['S36', 'tainan', 'penghu', 7],
  ['S37', 'chiayi', 'kinmen', 8],
  ['S38', 'taitung', 'greenisland', 3],
  ['S40', 'taitung', 'orchidisland', 4],
];
const toTicket =
  (deck: 'LONG' | 'SHORT') =>
  ([id, a, b, value]: TRow): TicketDef => ({
    id: asTicketId(id),
    a: asCityId(a),
    b: asCityId(b),
    value,
    deck,
  });
export const TICKETS_V3: readonly TicketDef[] = [
  ...longRows.map(toTicket('LONG')),
  ...shortRows.map(toTicket('SHORT')),
];

const V3_META: MapMeta = {
  mapId: 'taiwan',
  version: 3,
  nameZh: '台灣本島與離島',
  nameEn: 'Taiwan & Outlying Islands',
};

export const CONTENT_V3: GameContent = {
  meta: V3_META,
  cities: CITIES_V3,
  routes: V3_ROUTES,
  tickets: TICKETS_V3,
};
