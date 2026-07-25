import { asTicketId, asCityId } from '@trm/shared';
import type { TicketDef } from '../types';

/**
 * 8 LONG + 48 SHORT missions. Values track the shortest legal path between the two stops (the
 * same relationship `generateTickets` uses), so a mission is worth roughly what it costs to
 * build: SHORT missions pay their distance, LONG missions pay it plus two for the risk of
 * committing to a crossing of the whole basin.
 *
 * Every one of the 44 stops appears at least once across the two decks, and the SHORT deck is
 * deliberately weighted towards the 5–8 band — on a network this compact that is one or two
 * lines' worth of building, which keeps a hand of three missions playable from any start.
 */
type Row = [string, string, string, number];

const longRows: readonly Row[] = [
  ['TPL1', 'tp_keelung', 'tp_huanbei', 23],
  ['TPL2', 'tp_keelung', 'tp_airport', 22],
  ['TPL3', 'tp_maokong', 'tp_thsrtaoyuan', 21],
  ['TPL4', 'tp_xizhi', 'tp_huanbei', 21],
  ['TPL5', 'tp_neihu', 'tp_yingge', 20],
  ['TPL6', 'tp_bali', 'tp_maokong', 19],
  ['TPL7', 'tp_nangang', 'tp_thsrtaoyuan', 19],
  ['TPL8', 'tp_fishermanswharf', 'tp_xindian', 18],
];

const shortRows: readonly Row[] = [
  ['TPS1', 'tp_tamsui', 'tp_taipeimain', 7],
  ['TPS2', 'tp_tamsui', 'tp_zhonghe', 11],
  ['TPS3', 'tp_fishermanswharf', 'tp_shilin', 7],
  ['TPS4', 'tp_bali', 'tp_sanchong', 7],
  ['TPS5', 'tp_guandu', 'tp_zhongxiaofuxing', 7],
  ['TPS6', 'tp_guandu', 'tp_banqiao', 7],
  ['TPS7', 'tp_beitou', 'tp_gongguan', 8],
  ['TPS8', 'tp_beitou', 'tp_songshanairport', 5],
  ['TPS9', 'tp_shilin', 'tp_taipei101', 7],
  ['TPS10', 'tp_shilin', 'tp_xinzhuang', 6],
  ['TPS11', 'tp_luzhou', 'tp_dapinglin', 8],
  ['TPS12', 'tp_sanchong', 'tp_taipeizoo', 8],
  ['TPS13', 'tp_sanchong', 'tp_cityhall', 6],
  ['TPS14', 'tp_zhongshan', 'tp_xindian', 8],
  ['TPS15', 'tp_zhongshan', 'tp_banqiao', 5],
  ['TPS16', 'tp_taipeimain', 'tp_keelung', 10],
  ['TPS17', 'tp_taipeimain', 'tp_linkou', 7],
  ['TPS18', 'tp_ximen', 'tp_nangang', 7],
  ['TPS19', 'tp_ximen', 'tp_dapinglin', 5],
  ['TPS20', 'tp_longshan', 'tp_songshan', 7],
  ['TPS21', 'tp_longshan', 'tp_keelung', 12],
  ['TPS22', 'tp_cksmemorial', 'tp_neihu', 8],
  ['TPS23', 'tp_cksmemorial', 'tp_tucheng', 6],
  ['TPS24', 'tp_dongmen', 'tp_xizhi', 7],
  ['TPS25', 'tp_dongmen', 'tp_banqiao', 5],
  ['TPS26', 'tp_guting', 'tp_yingge', 9],
  ['TPS27', 'tp_daan', 'tp_zhonghe', 6],
  ['TPS28', 'tp_daan', 'tp_keelung', 9],
  ['TPS29', 'tp_zhongxiaofuxing', 'tp_xinzhuang', 6],
  ['TPS30', 'tp_zhongxiaofuxing', 'tp_maokong', 6],
  ['TPS31', 'tp_nanjingfuxing', 'tp_gongguan', 5],
  ['TPS32', 'tp_nanjingfuxing', 'tp_dapinglin', 7],
  ['TPS33', 'tp_songshanairport', 'tp_banqiao', 8],
  ['TPS34', 'tp_songshanairport', 'tp_xindian', 10],
  ['TPS35', 'tp_dazhi', 'tp_gongguan', 7],
  ['TPS36', 'tp_neihu', 'tp_zhonghe', 11],
  ['TPS37', 'tp_songshan', 'tp_xinzhuang', 8],
  ['TPS38', 'tp_cityhall', 'tp_huilong', 10],
  ['TPS39', 'tp_nangang', 'tp_gongguan', 8],
  ['TPS40', 'tp_gongguan', 'tp_tucheng', 5],
  ['TPS41', 'tp_dapinglin', 'tp_tucheng', 6],
  ['TPS42', 'tp_zhonghe', 'tp_yingge', 7],
  ['TPS43', 'tp_banqiao', 'tp_taoyuan', 7],
  ['TPS44', 'tp_tucheng', 'tp_linkou', 7],
  ['TPS45', 'tp_sanxia', 'tp_xinzhuang', 6],
  ['TPS46', 'tp_yingge', 'tp_linkou', 8],
  ['TPS47', 'tp_huilong', 'tp_thsrtaoyuan', 5],
  ['TPS48', 'tp_airport', 'tp_taoyuan', 4],
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
