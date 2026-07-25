import type { RouteColor, RouteLength } from '@trm/shared';
import { asRouteId, asCityId } from '@trm/shared';
import type { RouteDef } from '../types';

/**
 * Compact route rows: [id, cityA, cityB, color, length, flag, bow?].
 * flag: '' | 'D-A'..'D-H' (parallel-route pair) | 'T' (tunnel) | 'F1' (ferry loco count).
 * A route is at most one of {double, tunnel, ferry} on this map, matching the bundled Taiwan
 * map's authoring convention. `bow` (optional) overrides the automatic curve-apex deviation.
 *
 * Because the stops sit at true positions, the network is the region's real one: metro in the
 * basin, the coast road round the north shore, the Keelung-river corridor east to Ruifang and the
 * north-east cape, the mountain roads south through Pingxi/Shiding/Pinglin, and the Dahan valley
 * down to Yingge. What the flags mean here:
 *  - **Parallel pairs (D-*)** are the trunk corridors every basin line shares — the eight
 *    approaches to Taipei Main, Zhongxiao, Xinyi/Nangang and the Keelung valley.
 *  - **Tunnels (T)** are the seven crossings that leave the basin: over Yangmingshan to the north
 *    coast, over the ridges to Pinglin, and up the Nanshi valley to Wulai and Sanxia.
 *  - **Ferries (F1)** are the two Tamsui estuary crossings to Bali — the one part of this network
 *    that is genuinely a boat.
 */
type Row = [string, string, string, RouteColor, RouteLength, string, number?];

const ROWS: readonly Row[] = [
  // --- 淡水河口 the estuary: the LRT, the ferries, and the climb onto the Linkou terrace ---
  ['TPR1', 'tp_tamsui', 'tp_fishermanswharf', 'RED', 1, ''],
  ['TPR2', 'tp_tamsui', 'tp_bali', 'GRAY', 2, 'F1'],
  ['TPR3', 'tp_fishermanswharf', 'tp_bali', 'GRAY', 2, 'F1'],
  ['TPR4', 'tp_bali', 'tp_linkou', 'GREEN', 2, ''],
  ['TPR5', 'tp_tamsui', 'tp_guandu', 'BLUE', 2, ''],
  ['TPR6', 'tp_guandu', 'tp_beitou', 'WHITE', 1, ''],
  ['TPR7', 'tp_guandu', 'tp_luzhou', 'GRAY', 1, ''],
  ['TPR8', 'tp_beitou', 'tp_shilin', 'ORANGE', 2, ''],

  // --- 北海岸 the north coast, and the two roads over Yangmingshan ---
  ['TPR9', 'tp_tamsui', 'tp_sanzhi', 'YELLOW', 3, ''],
  ['TPR10', 'tp_sanzhi', 'tp_shimen', 'PURPLE', 2, ''],
  ['TPR11', 'tp_shimen', 'tp_jinshan', 'BLACK', 3, ''],
  ['TPR12', 'tp_jinshan', 'tp_wanli', 'GRAY', 2, ''],
  ['TPR13', 'tp_wanli', 'tp_keelung', 'GRAY', 2, ''],
  ['TPR14', 'tp_sanzhi', 'tp_beitou', 'GRAY', 4, 'T'],
  ['TPR15', 'tp_jinshan', 'tp_shilin', 'BLUE', 4, 'T'],

  // --- 臺北盆地 the basin ---
  ['TPR16', 'tp_shilin', 'tp_taipeimain', 'WHITE', 2, ''],
  ['TPR17', 'tp_shilin', 'tp_songshanairport', 'ORANGE', 1, ''],
  ['TPR18', 'tp_taipeimain', 'tp_taipei101', 'YELLOW', 2, 'D-A'],
  ['TPR19', 'tp_taipeimain', 'tp_taipei101', 'PURPLE', 2, 'D-A'],
  ['TPR20', 'tp_songshanairport', 'tp_taipei101', 'BLACK', 1, 'D-B'],
  ['TPR21', 'tp_songshanairport', 'tp_taipei101', 'RED', 1, 'D-B'],
  ['TPR22', 'tp_taipeimain', 'tp_songshanairport', 'GREEN', 1, ''],
  ['TPR23', 'tp_songshanairport', 'tp_neihu', 'GRAY', 2, ''],
  ['TPR24', 'tp_neihu', 'tp_nangang', 'BLUE', 1, ''],
  ['TPR25', 'tp_taipei101', 'tp_nangang', 'WHITE', 2, 'D-C'],
  ['TPR26', 'tp_taipei101', 'tp_nangang', 'ORANGE', 2, 'D-C'],
  ['TPR27', 'tp_taipeimain', 'tp_gongguan', 'YELLOW', 1, 'D-D'],
  ['TPR28', 'tp_taipeimain', 'tp_gongguan', 'PURPLE', 1, 'D-D'],
  ['TPR29', 'tp_gongguan', 'tp_taipeizoo', 'BLACK', 2, ''],
  ['TPR30', 'tp_taipeizoo', 'tp_maokong', 'RED', 1, ''],
  ['TPR31', 'tp_taipeizoo', 'tp_taipei101', 'GREEN', 2, ''],
  ['TPR32', 'tp_taipeimain', 'tp_sanchong', 'BLUE', 1, 'D-E'],
  ['TPR33', 'tp_taipeimain', 'tp_sanchong', 'GRAY', 1, 'D-E'],
  ['TPR34', 'tp_sanchong', 'tp_luzhou', 'WHITE', 1, ''],
  ['TPR35', 'tp_sanchong', 'tp_xinzhuang', 'ORANGE', 1, ''],
  ['TPR36', 'tp_taipeimain', 'tp_banqiao', 'YELLOW', 2, 'D-F'],
  ['TPR37', 'tp_taipeimain', 'tp_banqiao', 'PURPLE', 2, 'D-F'],

  // --- 大漢溪畔 the Dahan valley ---
  ['TPR38', 'tp_banqiao', 'tp_xinzhuang', 'BLACK', 1, ''],
  ['TPR39', 'tp_banqiao', 'tp_zhonghe', 'RED', 1, 'D-G'],
  ['TPR40', 'tp_banqiao', 'tp_zhonghe', 'GREEN', 1, 'D-G'],
  ['TPR41', 'tp_zhonghe', 'tp_gongguan', 'GRAY', 1, ''],
  ['TPR42', 'tp_zhonghe', 'tp_xindian', 'BLUE', 2, ''],
  ['TPR43', 'tp_zhonghe', 'tp_tucheng', 'WHITE', 2, ''],
  ['TPR44', 'tp_banqiao', 'tp_shulin', 'ORANGE', 2, ''],
  ['TPR45', 'tp_shulin', 'tp_tucheng', 'YELLOW', 1, ''],
  ['TPR46', 'tp_shulin', 'tp_yingge', 'PURPLE', 2, ''],
  ['TPR47', 'tp_yingge', 'tp_sanxia', 'BLACK', 1, ''],
  ['TPR48', 'tp_sanxia', 'tp_tucheng', 'GRAY', 2, ''],
  ['TPR49', 'tp_xinzhuang', 'tp_linkou', 'RED', 3, ''],
  ['TPR50', 'tp_linkou', 'tp_luzhou', 'GREEN', 3, ''],

  // --- 基隆河谷 the Keelung river corridor and the north-east cape ---
  ['TPR51', 'tp_nangang', 'tp_xizhi', 'BLUE', 2, 'D-H'],
  ['TPR52', 'tp_nangang', 'tp_xizhi', 'WHITE', 2, 'D-H'],
  ['TPR53', 'tp_xizhi', 'tp_neihu', 'ORANGE', 2, ''],
  ['TPR54', 'tp_xizhi', 'tp_keelung', 'GRAY', 3, ''],
  ['TPR55', 'tp_keelung', 'tp_ruifang', 'YELLOW', 2, ''],
  ['TPR56', 'tp_ruifang', 'tp_shuangxi', 'PURPLE', 3, ''],
  ['TPR57', 'tp_shuangxi', 'tp_gongliao', 'BLACK', 1, ''],
  ['TPR58', 'tp_ruifang', 'tp_gongliao', 'GRAY', 4, ''],
  ['TPR59', 'tp_ruifang', 'tp_pingxi', 'RED', 3, ''],
  ['TPR60', 'tp_pingxi', 'tp_shuangxi', 'GREEN', 4, ''],
  ['TPR61', 'tp_pingxi', 'tp_xizhi', 'GRAY', 3, ''],
  ['TPR62', 'tp_pingxi', 'tp_shiding', 'GRAY', 3, ''],

  // --- 南部山區 the southern mountains ---
  ['TPR63', 'tp_taipeizoo', 'tp_shiding', 'ORANGE', 3, ''],
  ['TPR64', 'tp_shulin', 'tp_xinzhuang', 'YELLOW', 2, ''],
  ['TPR65', 'tp_shiding', 'tp_pinglin', 'GRAY', 2, 'T'],
  ['TPR66', 'tp_pinglin', 'tp_pingxi', 'PURPLE', 3, 'T'],
  ['TPR67', 'tp_pinglin', 'tp_xindian', 'BLACK', 6, 'T'],
  ['TPR68', 'tp_xindian', 'tp_gongguan', 'RED', 2, ''],
  ['TPR69', 'tp_xindian', 'tp_wulai', 'GREEN', 3, ''],
  ['TPR70', 'tp_wulai', 'tp_sanxia', 'GRAY', 6, 'T'],
  ['TPR71', 'tp_maokong', 'tp_shiding', 'BLUE', 2, 'T'],
  ['TPR72', 'tp_xindian', 'tp_taipeizoo', 'WHITE', 2, ''],
];

function buildRoute([id, a, b, color, length, flag, bow]: Row): RouteDef {
  const base = {
    id: asRouteId(id),
    a: asCityId(a),
    b: asCityId(b),
    color,
    length,
  };
  const withBow = bow !== undefined ? { bow } : {};
  if (flag.startsWith('D-'))
    return { ...base, doubleGroup: flag.slice(2), ferryLocos: 0, isTunnel: false, ...withBow };
  if (flag === 'T') return { ...base, ferryLocos: 0, isTunnel: true, ...withBow };
  if (flag.startsWith('F'))
    return { ...base, ferryLocos: Number(flag.slice(1)), isTunnel: false, ...withBow };
  return { ...base, ferryLocos: 0, isTunnel: false, ...withBow };
}

export const TAIPEI_ROUTES: readonly RouteDef[] = ROWS.map(buildRoute);
