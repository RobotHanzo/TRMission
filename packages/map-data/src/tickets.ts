import { asTicketId, asCityId } from '@trm/shared';
import type { TicketDef } from './types';

type Row = [string, string, string, number];

const longRows: readonly Row[] = [
  ['L1', 'keelung', 'kaohsiung', 22],
  ['L2', 'taipei', 'taitung', 16],
  ['L3', 'tamsui', 'hengchun', 21],
  ['L4', 'matsu', 'orchidisland', 25],
  ['L5', 'hualien', 'tainan', 17],
  ['L6', 'kinmen', 'yilan', 24],
];

const shortRows: readonly Row[] = [
  ['S1', 'keelung', 'hsinchu', 8],
  ['S2', 'banqiao', 'hsinchu', 5],
  ['S3', 'taipei', 'suao', 6],
  ['S4', 'ruifang', 'yilan', 5],
  ['S5', 'taoyuan', 'miaoli', 4],
  ['S6', 'taipei', 'taichung', 9],
  ['S7', 'tamsui', 'hsinchu', 6],
  ['S8', 'hsinchu', 'changhua', 6],
  ['S9', 'taichung', 'chiayi', 6],
  ['S10', 'miaoli', 'yuanlin', 5],
  ['S11', 'taichung', 'sunmoonlake', 5],
  ['S12', 'changhua', 'alishan', 7],
  ['S13', 'taichung', 'yuli', 12],
  ['S14', 'chiayi', 'chishang', 10],
  ['S15', 'zhunan', 'changhua', 5],
  ['S16', 'chiayi', 'kaohsiung', 5],
  ['S17', 'tainan', 'pingtung', 4],
  ['S18', 'douliu', 'tainan', 4],
  ['S19', 'kaohsiung', 'fangliao', 5],
  ['S20', 'changhua', 'tainan', 7],
  ['S21', 'nantou', 'tainan', 6],
  ['S22', 'pingtung', 'taitung', 11],
  ['S23', 'kaohsiung', 'hengchun', 8],
  ['S24', 'fangliao', 'zhiben', 7],
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
  ['S39', 'fangliao', 'liuqiu', 3],
  ['S40', 'taitung', 'orchidisland', 4],
];

const toTicket = (deck: 'LONG' | 'SHORT') => ([id, a, b, value]: Row): TicketDef => ({
  id: asTicketId(id),
  a: asCityId(a),
  b: asCityId(b),
  value,
  deck,
});

export const LONG_TICKETS: readonly TicketDef[] = longRows.map(toTicket('LONG'));
export const SHORT_TICKETS: readonly TicketDef[] = shortRows.map(toTicket('SHORT'));
export const TICKETS: readonly TicketDef[] = [...LONG_TICKETS, ...SHORT_TICKETS];
