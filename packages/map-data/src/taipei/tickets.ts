import { asTicketId, asCityId } from '@trm/shared';
import type { TicketDef } from '../types';

/**
 * 8 LONG + 48 SHORT missions. Values track the shortest legal path between the two stops (the
 * same relationship `generateTickets` uses), so a mission is worth roughly what it costs to
 * build: SHORT missions pay their distance, LONG missions pay it plus two for the risk of
 * committing to a crossing of the whole region.
 *
 * The LONG deck is deliberately corner-to-corner — Bali or Tamsui in the west to Gongliao,
 * Shuangxi or Ruifang out on the north-east cape, and Shimen on the north coast down to Wulai in
 * the southern mountains. Every one of the 40 stops appears at least once across the two decks,
 * and the SHORT deck sits mostly in the 5–10 band, which on this network is one or two corridors'
 * worth of building.
 */
type Row = [string, string, string, number];

const longRows: readonly Row[] = [
  ['TPL1', 'tp_bali', 'tp_gongliao', 22],
  ['TPL2', 'tp_yingge', 'tp_gongliao', 21],
  ['TPL3', 'tp_tamsui', 'tp_shuangxi', 19],
  ['TPL4', 'tp_linkou', 'tp_ruifang', 17],
  ['TPL5', 'tp_sanxia', 'tp_shuangxi', 19],
  ['TPL6', 'tp_shimen', 'tp_wulai', 17],
  ['TPL7', 'tp_keelung', 'tp_sanxia', 16],
  ['TPL8', 'tp_fishermanswharf', 'tp_ruifang', 17],
];

const shortRows: readonly Row[] = [
  ['TPS1', 'tp_tamsui', 'tp_taipeimain', 5],
  ['TPS2', 'tp_tamsui', 'tp_xizhi', 10],
  ['TPS3', 'tp_fishermanswharf', 'tp_sanchong', 5],
  ['TPS4', 'tp_bali', 'tp_taipei101', 9],
  ['TPS5', 'tp_guandu', 'tp_taipei101', 5],
  ['TPS6', 'tp_guandu', 'tp_xindian', 6],
  ['TPS7', 'tp_beitou', 'tp_gongguan', 5],
  ['TPS8', 'tp_beitou', 'tp_keelung', 10],
  ['TPS9', 'tp_luzhou', 'tp_taipeizoo', 5],
  ['TPS10', 'tp_luzhou', 'tp_pinglin', 10],
  ['TPS11', 'tp_linkou', 'tp_zhonghe', 5],
  ['TPS12', 'tp_linkou', 'tp_neihu', 8],
  ['TPS13', 'tp_shilin', 'tp_banqiao', 4],
  ['TPS14', 'tp_shilin', 'tp_pingxi', 8],
  ['TPS15', 'tp_shilin', 'tp_sanzhi', 6],
  ['TPS16', 'tp_taipeimain', 'tp_keelung', 8],
  ['TPS17', 'tp_taipeimain', 'tp_wulai', 6],
  ['TPS18', 'tp_taipeimain', 'tp_shiding', 6],
  ['TPS19', 'tp_maokong', 'tp_yingge', 9],
  ['TPS20', 'tp_songshanairport', 'tp_wanli', 7],
  ['TPS21', 'tp_taipei101', 'tp_pinglin', 7],
  ['TPS22', 'tp_taipei101', 'tp_sanzhi', 8],
  ['TPS23', 'tp_songshanairport', 'tp_tucheng', 5],
  ['TPS24', 'tp_songshanairport', 'tp_ruifang', 9],
  ['TPS25', 'tp_gongguan', 'tp_jinshan', 7],
  ['TPS26', 'tp_gongguan', 'tp_shuangxi', 12],
  ['TPS27', 'tp_gongguan', 'tp_keelung', 9],
  ['TPS28', 'tp_sanchong', 'tp_pingxi', 9],
  ['TPS29', 'tp_sanchong', 'tp_wulai', 7],
  ['TPS30', 'tp_sanzhi', 'tp_zhonghe', 10],
  ['TPS31', 'tp_shimen', 'tp_neihu', 10],
  ['TPS32', 'tp_jinshan', 'tp_banqiao', 8],
  ['TPS33', 'tp_jinshan', 'tp_xizhi', 7],
  ['TPS34', 'tp_wanli', 'tp_taipeizoo', 10],
  ['TPS35', 'tp_neihu', 'tp_zhonghe', 5],
  ['TPS36', 'tp_nangang', 'tp_xinzhuang', 6],
  ['TPS37', 'tp_nangang', 'tp_shulin', 8],
  ['TPS38', 'tp_xizhi', 'tp_banqiao', 7],
  ['TPS39', 'tp_ruifang', 'tp_taipeizoo', 9],
  ['TPS40', 'tp_pingxi', 'tp_zhonghe', 9],
  ['TPS41', 'tp_shuangxi', 'tp_shiding', 7],
  ['TPS42', 'tp_taipeizoo', 'tp_shulin', 6],
  ['TPS43', 'tp_maokong', 'tp_banqiao', 5],
  ['TPS44', 'tp_maokong', 'tp_xinzhuang', 6],
  ['TPS45', 'tp_shiding', 'tp_yingge', 11],
  ['TPS46', 'tp_pinglin', 'tp_tucheng', 10],
  ['TPS47', 'tp_xindian', 'tp_shulin', 5],
  ['TPS48', 'tp_wulai', 'tp_tucheng', 7],
];

const toTicket =
  (deck: 'LONG' | 'SHORT') =>
  ([id, a, b, value]: Row): TicketDef => ({
    id: asTicketId(id),
    a: asCityId(a),
    b: asCityId(b),
    value,
    deck,
  });

export const TAIPEI_LONG_TICKETS: readonly TicketDef[] = longRows.map(toTicket('LONG'));
export const TAIPEI_SHORT_TICKETS: readonly TicketDef[] = shortRows.map(toTicket('SHORT'));
export const TAIPEI_TICKETS: readonly TicketDef[] = [
  ...TAIPEI_LONG_TICKETS,
  ...TAIPEI_SHORT_TICKETS,
];
