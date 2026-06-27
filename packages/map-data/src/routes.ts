import type { RouteColor, RouteLength } from '@trm/shared';
import { asRouteId, asCityId } from '@trm/shared';
import type { RouteDef } from './types';

/**
 * Compact route rows: [id, cityA, cityB, color, length, flag].
 * flag: '' | 'D-A'..'D-J' (double-route pair) | 'T' (tunnel) | 'F1'/'F2'/'F3' (ferry loco count).
 * A route is at most one of {double, tunnel, ferry} on this map.
 */
type Row = [string, string, string, RouteColor, RouteLength, string];

const ROWS: readonly Row[] = [
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
  ['R25', 'zhunan', 'dajia', 'WHITE', 2, ''],
  ['R26', 'dajia', 'shalu', 'YELLOW', 1, ''],
  ['R27', 'dajia', 'miaoli', 'GREEN', 2, ''],
  ['R28', 'shalu', 'changhua', 'PURPLE', 2, ''],
  ['R29', 'shalu', 'taichung', 'RED', 1, ''],
  ['R30', 'shalu', 'yuanlin', 'BLUE', 3, ''],
  ['R31', 'changhua', 'lukang', 'RED', 1, ''],
  ['R32', 'lukang', 'yuanlin', 'ORANGE', 2, ''],
  ['R33', 'changhua', 'yuanlin', 'BLUE', 1, 'D-F'],
  ['R34', 'changhua', 'yuanlin', 'BLACK', 1, 'D-F'],
  ['R35', 'taichung', 'yuanlin', 'YELLOW', 2, ''],
  ['R36', 'yuanlin', 'ershui', 'YELLOW', 1, ''],
  ['R37', 'ershui', 'douliu', 'ORANGE', 1, ''],
  ['R38', 'changhua', 'douliu', 'PURPLE', 3, ''],
  ['R39', 'douliu', 'chiayi', 'GREEN', 2, 'D-G'],
  ['R40', 'douliu', 'chiayi', 'WHITE', 2, 'D-G'],
  ['R41', 'taichung', 'nantou', 'WHITE', 2, ''],
  ['R42', 'yuanlin', 'nantou', 'PURPLE', 2, ''],
  ['R43', 'nantou', 'ershui', 'GRAY', 1, ''],
  ['R44', 'nantou', 'sunmoonlake', 'RED', 2, 'T'],
  ['R45', 'ershui', 'sunmoonlake', 'GREEN', 3, 'T'],
  ['R46', 'taichung', 'sunmoonlake', 'BLUE', 4, 'T'],
  ['R47', 'nantou', 'alishan', 'WHITE', 3, 'T'],
  ['R48', 'chiayi', 'alishan', 'BLUE', 3, 'T'],
  ['R49', 'alishan', 'sunmoonlake', 'ORANGE', 4, 'T'],
  ['R50', 'sunmoonlake', 'hualien', 'GRAY', 8, 'T'],
  ['R51', 'chiayi', 'xinying', 'PURPLE', 1, ''],
  ['R52', 'douliu', 'xinying', 'RED', 2, ''],
  ['R53', 'xinying', 'tainan', 'BLACK', 2, 'D-H'],
  ['R54', 'xinying', 'tainan', 'YELLOW', 2, 'D-H'],
  ['R55', 'chiayi', 'tainan', 'GREEN', 3, ''],
  ['R56', 'tainan', 'kaohsiung', 'RED', 2, 'D-I'],
  ['R57', 'tainan', 'kaohsiung', 'WHITE', 2, 'D-I'],
  ['R58', 'kaohsiung', 'pingtung', 'YELLOW', 2, 'D-J'],
  ['R59', 'kaohsiung', 'pingtung', 'BLUE', 2, 'D-J'],
  ['R60', 'tainan', 'pingtung', 'PURPLE', 3, ''],
  ['R61', 'pingtung', 'chaozhou', 'BLUE', 1, ''],
  ['R62', 'kaohsiung', 'chaozhou', 'GREEN', 2, ''],
  ['R63', 'chaozhou', 'fangliao', 'ORANGE', 2, ''],
  ['R64', 'pingtung', 'fangliao', 'WHITE', 3, ''],
  ['R65', 'fangliao', 'dawu', 'BLACK', 4, 'T'],
  ['R66', 'dawu', 'zhiben', 'GREEN', 2, 'T'],
  ['R67', 'zhiben', 'taitung', 'RED', 1, ''],
  ['R68', 'fangliao', 'hengchun', 'GRAY', 3, 'T'],
  ['R69', 'hengchun', 'dawu', 'YELLOW', 3, 'T'],
  ['R70', 'hengchun', 'taitung', 'GRAY', 6, ''],
  ['R71', 'taitung', 'chishang', 'WHITE', 2, ''],
  ['R72', 'chishang', 'yuli', 'ORANGE', 1, ''],
  ['R73', 'taitung', 'yuli', 'BLACK', 3, ''],
  ['R74', 'yuli', 'hualien', 'PURPLE', 3, ''],
  ['R75', 'hualien', 'suao', 'BLUE', 4, 'T'],
  ['R76', 'suao', 'luodong', 'BLACK', 1, ''],
  ['R77', 'suao', 'yilan', 'PURPLE', 1, ''],
  ['R78', 'luodong', 'yilan', 'GREEN', 1, ''],
  ['R79', 'yilan', 'toucheng', 'YELLOW', 1, ''],
  ['R80', 'toucheng', 'ruifang', 'RED', 3, 'T'],
  ['R81', 'keelung', 'matsu', 'GRAY', 6, 'F2'],
  ['R82', 'chiayi', 'penghu', 'GRAY', 3, 'F1'],
  ['R83', 'kaohsiung', 'penghu', 'GRAY', 4, 'F2'],
  ['R84', 'penghu', 'kinmen', 'GRAY', 4, 'F2'],
  ['R85', 'kaohsiung', 'kinmen', 'GRAY', 6, 'F3'],
  ['R86', 'fangliao', 'liuqiu', 'GRAY', 2, 'F1'],
  ['R87', 'kaohsiung', 'liuqiu', 'GRAY', 3, 'F1'],
  ['R88', 'taitung', 'greenisland', 'GRAY', 2, 'F1'],
  ['R89', 'taitung', 'orchidisland', 'GRAY', 3, 'F2'],
  ['R90', 'greenisland', 'orchidisland', 'GRAY', 2, 'F1'],
];

function build([id, a, b, color, length, flag]: Row): RouteDef {
  const base = {
    id: asRouteId(id),
    a: asCityId(a),
    b: asCityId(b),
    color,
    length,
  };
  if (flag.startsWith('D-')) return { ...base, doubleGroup: flag.slice(2), ferryLocos: 0, isTunnel: false };
  if (flag === 'T') return { ...base, ferryLocos: 0, isTunnel: true };
  if (flag.startsWith('F')) return { ...base, ferryLocos: Number(flag.slice(1)), isTunnel: false };
  return { ...base, ferryLocos: 0, isTunnel: false };
}

export const ROUTES: readonly RouteDef[] = ROWS.map(build);
