import type { RouteColor, RouteLength } from '@trm/shared';
import { asRouteId, asCityId } from '@trm/shared';
import type { RouteDef } from '../types';

/**
 * Compact route rows: [id, cityA, cityB, color, length, flag, bow?].
 * flag: '' | 'D-A'..'D-L' (parallel-route pair) | 'T' (tunnel) | 'F1'/'F2' (ferry loco count).
 * A route is at most one of {double, tunnel, ferry} on this map, matching the bundled Taiwan
 * map's authoring convention. `bow` (optional) overrides the automatic curve-apex deviation.
 *
 * What the mechanics mean on a metro board:
 *  - **Parallel pairs (D-*)** are the trunk corridors every line shares — the Taipei Main
 *    approaches, the Zhongxiao spine, the Xinyi/Nangang ends. They are where the board is
 *    fought over, so twelve of them carry two tracks.
 *  - **Tunnels (T)** are the crossings that leave the basin: the hills between Daan/Xinyi and
 *    Muzha, the gondola up to Maokong, the Xindian ridge, the climb onto the Linkou terrace,
 *    and the Keelung corridor. Exactly the sections that are bored or elevated in real life.
 *  - **Ferries (F*)** are the two Tamsui estuary crossings to Bali, the one part of this
 *    network that is genuinely a boat.
 */
type Row = [string, string, string, RouteColor, RouteLength, string, number?];

const ROWS: readonly Row[] = [
  // --- 淡水河口 Tamsui estuary: LRT, ferries, and the climb onto the Linkou terrace ---
  ['TPR1', 'tp_tamsui', 'tp_fishermanswharf', 'RED', 2, ''],
  ['TPR2', 'tp_tamsui', 'tp_bali', 'GRAY', 2, 'F1'],
  ['TPR3', 'tp_fishermanswharf', 'tp_bali', 'GRAY', 2, 'F1'],
  ['TPR4', 'tp_bali', 'tp_linkou', 'GRAY', 3, 'T'],
  ['TPR5', 'tp_tamsui', 'tp_guandu', 'GREEN', 2, ''],
  ['TPR6', 'tp_guandu', 'tp_beitou', 'BLUE', 1, ''],
  ['TPR7', 'tp_guandu', 'tp_luzhou', 'GRAY', 2, ''],
  ['TPR8', 'tp_beitou', 'tp_shilin', 'WHITE', 2, ''],
  ['TPR9', 'tp_shilin', 'tp_zhongshan', 'ORANGE', 2, ''],
  ['TPR10', 'tp_shilin', 'tp_dazhi', 'GRAY', 2, ''],

  // --- 基隆河北岸 Keelung river north bank: Wenhu line towards Neihu ---
  ['TPR11', 'tp_dazhi', 'tp_songshanairport', 'YELLOW', 1, 'D-K'],
  ['TPR12', 'tp_dazhi', 'tp_songshanairport', 'PURPLE', 1, 'D-K'],
  ['TPR13', 'tp_dazhi', 'tp_neihu', 'BLACK', 3, ''],
  ['TPR14', 'tp_neihu', 'tp_nangang', 'RED', 2, ''],
  ['TPR15', 'tp_dazhi', 'tp_songshan', 'GREEN', 3, ''],
  ['TPR16', 'tp_songshanairport', 'tp_nanjingfuxing', 'BLUE', 1, ''],

  // --- 臺北車站北側 north of Taipei Main ---
  ['TPR17', 'tp_zhongshan', 'tp_taipeimain', 'WHITE', 1, 'D-A'],
  ['TPR18', 'tp_zhongshan', 'tp_taipeimain', 'ORANGE', 1, 'D-A'],
  ['TPR19', 'tp_zhongshan', 'tp_nanjingfuxing', 'GRAY', 2, ''],
  ['TPR20', 'tp_zhongshan', 'tp_sanchong', 'YELLOW', 2, ''],
  ['TPR21', 'tp_nanjingfuxing', 'tp_songshan', 'PURPLE', 2, ''],
  ['TPR22', 'tp_nanjingfuxing', 'tp_zhongxiaofuxing', 'BLACK', 1, 'D-E'],
  ['TPR23', 'tp_nanjingfuxing', 'tp_zhongxiaofuxing', 'RED', 1, 'D-E'],

  // --- 東側走廊 the eastern corridor out to Keelung ---
  ['TPR24', 'tp_songshan', 'tp_cityhall', 'GREEN', 1, ''],
  ['TPR25', 'tp_songshan', 'tp_nangang', 'GRAY', 2, ''],
  ['TPR26', 'tp_nangang', 'tp_xizhi', 'BLUE', 2, 'D-J'],
  ['TPR27', 'tp_nangang', 'tp_xizhi', 'WHITE', 2, 'D-J'],
  ['TPR28', 'tp_xizhi', 'tp_keelung', 'GRAY', 3, 'T'],
  // The express to Keelung: arcs well north of Xizhi so it never sits on top of the
  // Nangang–Xizhi pair or the tunnel it overtakes (the auto-bow alone is too shallow here).
  ['TPR29', 'tp_nangang', 'tp_keelung', 'ORANGE', 4, '', -5.5],
  ['TPR30', 'tp_nangang', 'tp_cityhall', 'GRAY', 2, ''],

  // --- 信義／忠孝 Xinyi and Zhongxiao ---
  ['TPR31', 'tp_cityhall', 'tp_taipei101', 'YELLOW', 1, 'D-G'],
  ['TPR32', 'tp_cityhall', 'tp_taipei101', 'PURPLE', 1, 'D-G'],
  ['TPR33', 'tp_cityhall', 'tp_zhongxiaofuxing', 'BLACK', 2, ''],
  ['TPR34', 'tp_zhongxiaofuxing', 'tp_taipeimain', 'RED', 2, 'D-C'],
  ['TPR35', 'tp_zhongxiaofuxing', 'tp_taipeimain', 'GREEN', 2, 'D-C'],
  ['TPR36', 'tp_zhongxiaofuxing', 'tp_daan', 'BLUE', 1, 'D-F'],
  ['TPR37', 'tp_zhongxiaofuxing', 'tp_daan', 'WHITE', 1, 'D-F'],
  ['TPR38', 'tp_zhongxiaofuxing', 'tp_dongmen', 'ORANGE', 1, ''],
  ['TPR39', 'tp_daan', 'tp_taipei101', 'YELLOW', 2, ''],
  ['TPR40', 'tp_daan', 'tp_dongmen', 'PURPLE', 2, ''],

  // --- 南區丘陵 the southern hills: Muzha, the gondola, the Xindian ridge ---
  ['TPR41', 'tp_daan', 'tp_taipeizoo', 'GRAY', 3, 'T'],
  ['TPR42', 'tp_taipei101', 'tp_taipeizoo', 'BLACK', 3, 'T'],
  ['TPR43', 'tp_taipeizoo', 'tp_maokong', 'GRAY', 2, 'T'],
  ['TPR44', 'tp_maokong', 'tp_xindian', 'RED', 4, 'T'],

  // --- 中正區 the government quarter ---
  ['TPR45', 'tp_dongmen', 'tp_cksmemorial', 'GREEN', 1, ''],
  ['TPR46', 'tp_cksmemorial', 'tp_taipeimain', 'GRAY', 1, ''],
  ['TPR47', 'tp_cksmemorial', 'tp_guting', 'BLUE', 1, 'D-L'],
  ['TPR48', 'tp_cksmemorial', 'tp_guting', 'WHITE', 1, 'D-L'],
  ['TPR49', 'tp_cksmemorial', 'tp_ximen', 'ORANGE', 1, ''],
  ['TPR50', 'tp_ximen', 'tp_taipeimain', 'YELLOW', 1, 'D-B'],
  ['TPR51', 'tp_ximen', 'tp_taipeimain', 'PURPLE', 1, 'D-B'],
  ['TPR52', 'tp_ximen', 'tp_longshan', 'BLACK', 1, ''],
  ['TPR53', 'tp_longshan', 'tp_banqiao', 'RED', 2, 'D-H'],
  ['TPR54', 'tp_longshan', 'tp_banqiao', 'GREEN', 2, 'D-H'],
  ['TPR55', 'tp_longshan', 'tp_zhonghe', 'GRAY', 2, ''],

  // --- 新店溪南岸 south of the Xindian river ---
  ['TPR56', 'tp_guting', 'tp_gongguan', 'BLUE', 1, ''],
  ['TPR57', 'tp_guting', 'tp_zhonghe', 'WHITE', 2, ''],
  ['TPR58', 'tp_gongguan', 'tp_zhonghe', 'ORANGE', 2, ''],
  ['TPR59', 'tp_gongguan', 'tp_dapinglin', 'YELLOW', 2, ''],
  ['TPR60', 'tp_dapinglin', 'tp_xindian', 'PURPLE', 2, ''],
  ['TPR61', 'tp_dapinglin', 'tp_zhonghe', 'GRAY', 3, ''],
  ['TPR62', 'tp_dapinglin', 'tp_taipeizoo', 'BLACK', 3, ''],

  // --- 環狀線與三鶯線 the circular line and the Sanying branch ---
  ['TPR63', 'tp_zhonghe', 'tp_banqiao', 'RED', 2, 'D-I'],
  ['TPR64', 'tp_zhonghe', 'tp_banqiao', 'GREEN', 2, 'D-I'],
  ['TPR65', 'tp_zhonghe', 'tp_tucheng', 'BLUE', 3, ''],
  ['TPR66', 'tp_banqiao', 'tp_tucheng', 'GRAY', 2, ''],
  ['TPR67', 'tp_banqiao', 'tp_xinzhuang', 'WHITE', 2, ''],
  ['TPR68', 'tp_tucheng', 'tp_sanxia', 'ORANGE', 2, ''],
  ['TPR69', 'tp_sanxia', 'tp_yingge', 'YELLOW', 2, ''],

  // --- 桃園臺地 the Taoyuan terrace and the airport line ---
  ['TPR70', 'tp_yingge', 'tp_taoyuan', 'PURPLE', 2, ''],
  ['TPR71', 'tp_taoyuan', 'tp_huanbei', 'BLACK', 2, ''],
  ['TPR72', 'tp_taoyuan', 'tp_thsrtaoyuan', 'RED', 2, ''],
  ['TPR73', 'tp_taoyuan', 'tp_huilong', 'GRAY', 3, ''],
  ['TPR74', 'tp_huilong', 'tp_xinzhuang', 'GREEN', 2, ''],
  ['TPR75', 'tp_xinzhuang', 'tp_sanchong', 'BLUE', 2, ''],
  ['TPR76', 'tp_sanchong', 'tp_luzhou', 'WHITE', 1, ''],
  ['TPR77', 'tp_sanchong', 'tp_taipeimain', 'ORANGE', 2, 'D-D'],
  ['TPR78', 'tp_sanchong', 'tp_taipeimain', 'GRAY', 2, 'D-D'],
  ['TPR79', 'tp_xinzhuang', 'tp_linkou', 'YELLOW', 3, 'T'],
  ['TPR80', 'tp_linkou', 'tp_airport', 'PURPLE', 3, ''],
  ['TPR81', 'tp_airport', 'tp_thsrtaoyuan', 'GRAY', 2, ''],
  ['TPR82', 'tp_thsrtaoyuan', 'tp_huanbei', 'BLACK', 2, ''],
  ['TPR83', 'tp_linkou', 'tp_huilong', 'GRAY', 3, ''],
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
