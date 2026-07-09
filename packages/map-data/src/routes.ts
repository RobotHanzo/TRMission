import type { RouteColor, RouteLength } from '@trm/shared';
import { asRouteId, asCityId } from '@trm/shared';
import type { RouteDef } from './types';

/**
 * Compact route rows: [id, cityA, cityB, color, length, flag, bow?].
 * flag: '' | 'D-A'..'D-K' (double-route pair) | 'T' (tunnel) | 'F1'/'F2'/'F3' (ferry loco count).
 * A route is at most one of {double, tunnel, ferry} on this map. `bow` (optional) is the authored
 * curve-apex deviation carried over from the editor; absent ⇒ the automatic bow.
 */
export type Row = [string, string, string, RouteColor, RouteLength, string, number?];

const ROWS: readonly Row[] = [
  ['R1', 'taipei', 'banqiao', 'GRAY', 1, 'D-H'],
  ['R2', 'taipei', 'banqiao', 'GREEN', 1, 'D-H'],
  ['R3', 'taipei', 'keelung', 'YELLOW', 2, 'D-B'],
  ['R4', 'taipei', 'keelung', 'PURPLE', 2, 'D-B'],
  ['R5', 'taoyuan', 'yilan', 'RED', 3, 'T'],
  ['R6', 'keelung', 'yilan', 'GRAY', 3, 'T'],
  ['R7', 'hsinchu', 'miaoli', 'RED', 3, 'T', -1],
  ['R8', 'shalu', 'taichung', 'GREEN', 3, ''],
  ['R9', 'zhunan', 'shalu', 'GRAY', 4, ''],
  ['R10', 'miaoli', 'taichung', 'BLUE', 4, 'D-C', -1.2],
  ['R11', 'miaoli', 'taichung', 'YELLOW', 4, 'D-C', -1.2],
  ['R12', 'shalu', 'changhua', 'PURPLE', 4, ''],
  ['R13', 'taichung', 'nantou', 'BLACK', 3, ''],
  ['R14', 'zhunan', 'miaoli', 'WHITE', 2, ''],
  ['R15', 'changhua', 'nantou', 'GRAY', 4, '', 0.1],
  ['R16', 'keelung', 'matsu', 'GRAY', 8, 'F2'],
  ['R17', 'kinmen', 'matsu', 'GRAY', 8, 'F3'],
  ['R18', 'kinmen', 'penghu', 'GRAY', 6, 'F2'],
  ['R19', 'taitung', 'greenisland', 'GRAY', 1, 'F1'],
  ['R20', 'yilan', 'luodong', 'GREEN', 2, 'D-D'],
  ['R21', 'yilan', 'luodong', 'PURPLE', 2, 'D-D'],
  ['R22', 'hualien', 'yuli', 'GRAY', 2, ''],
  ['R23', 'nantou', 'yuli', 'WHITE', 4, 'T'],
  ['R24', 'nantou', 'hualien', 'ORANGE', 4, 'T'],
  ['R25', 'penghu', 'kaohsiung', 'GRAY', 4, 'F2', 5.6],
  ['R26', 'tainan', 'penghu', 'GRAY', 3, 'F1', 0.8],
  ['R27', 'changhua', 'douliu', 'YELLOW', 2, '', 0],
  ['R28', 'douliu', 'chiayi', 'RED', 3, '', 0],
  ['R29', 'nantou', 'alishan', 'GRAY', 3, 'T'],
  ['R30', 'chiayi', 'tainan', 'YELLOW', 4, 'D-E'],
  ['R31', 'chiayi', 'tainan', 'ORANGE', 4, 'D-E'],
  ['R32', 'chiayi', 'alishan', 'PURPLE', 2, ''],
  ['R33', 'alishan', 'taitung', 'BLACK', 4, 'T'],
  ['R34', 'taitung', 'orchidisland', 'GRAY', 3, 'F2', 1.9],
  ['R35', 'greenisland', 'orchidisland', 'GRAY', 1, 'F1'],
  ['R36', 'yuli', 'chishang', 'BLUE', 2, ''],
  ['R37', 'chishang', 'taitung', 'YELLOW', 2, ''],
  ['R38', 'kaohsiung', 'pingtung', 'ORANGE', 2, ''],
  ['R39', 'tainan', 'pingtung', 'GREEN', 4, ''],
  ['R40', 'taitung', 'pingtung', 'PURPLE', 6, ''],
  ['R41', 'taitung', 'chaozhou', 'BLUE', 6, '', -1.9],
  ['R42', 'pingtung', 'chaozhou', 'GRAY', 1, ''],
  ['R43', 'taichung', 'changhua', 'RED', 2, ''],
  ['R44', 'hsinchu', 'zhunan', 'WHITE', 2, 'D-F'],
  ['R45', 'hsinchu', 'zhunan', 'ORANGE', 2, 'D-F'],
  ['R46', 'taoyuan', 'hsinchu', 'BLACK', 2, 'D-G'],
  ['R47', 'taoyuan', 'hsinchu', 'GRAY', 2, 'D-G'],
  ['R48', 'taoyuan', 'banqiao', 'BLUE', 1, 'D-I'],
  ['R49', 'taoyuan', 'banqiao', 'WHITE', 1, 'D-I'],
  ['R50', 'jiji', 'alishan', 'GRAY', 2, '', -0.1],
  ['R51', 'nantou', 'jiji', 'ORANGE', 1, ''],
  ['R52', 'douliu', 'jiji', 'BLUE', 2, ''],
  ['R53', 'miaoli', 'hualien', 'GREEN', 6, 'T'],
  ['R54', 'changhua', 'huwei', 'BLACK', 3, ''],
  ['R55', 'huwei', 'tainan', 'WHITE', 6, ''],
  ['R56', 'luodong', 'guishan', 'GRAY', 2, 'F1'],
  ['R57', 'yilan', 'guishan', 'GRAY', 2, 'F1'],
  ['R58', 'chaozhou', 'hengchun', 'YELLOW', 2, ''],
  ['R59', 'kaohsiung', 'liuqiu', 'GRAY', 2, ''],
  ['R60', 'liuqiu', 'hengchun', 'RED', 2, ''],
  ['R61', 'hengchun', 'orchidisland', 'GRAY', 4, 'F2'],
  ['R62', 'luodong', 'hualien', 'RED', 4, 'D-J'],
  ['R63', 'luodong', 'hualien', 'YELLOW', 4, 'D-J'],
  ['R64', 'huwei', 'douliu', 'PURPLE', 1, ''],
  ['R65', 'taipei', 'pingxi', 'WHITE', 2, ''],
  ['R66', 'pingxi', 'yilan', 'GRAY', 1, 'T'],
  ['R67', 'keelung', 'pingxi', 'ORANGE', 2, ''],
  ['R68', 'liuqiu', 'chaozhou', 'WHITE', 1, '', 0.1],
  ['R69', 'hualien', 'greenisland', 'GRAY', 6, 'F3'],
  ['R70', 'zuoying', 'kaohsiung', 'BLUE', 1, 'D-K'],
  ['R71', 'tainan', 'zuoying', 'BLACK', 1, 'D-A'],
  ['R72', 'zuoying', 'kaohsiung', 'RED', 1, 'D-K'],
  ['R73', 'tainan', 'zuoying', 'GRAY', 1, 'D-A'],
  ['R74', 'kinmen', 'changhua', 'GRAY', 6, 'F2'],
  ['R75', 'shalu', 'matsu', 'GRAY', 8, 'F3'],
];

export function buildRoute([id, a, b, color, length, flag, bow]: Row): RouteDef {
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

export const ROUTES: readonly RouteDef[] = ROWS.map(buildRoute);
