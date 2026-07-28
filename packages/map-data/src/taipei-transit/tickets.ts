import { asTicketId, asCityId } from '@trm/shared';
import type { TicketDef } from '../types';

/**
 * 8 LONG + 55 SHORT missions, the draft's own deck (ids renumbered on adoption). Values were
 * produced by the builder's distance-based generator over this network, so a mission pays about
 * what its shortest path costs; two values sit one above today's shortest path (TTL5, TTS16) —
 * the author's numbers are kept verbatim rather than re-derived.
 */
type Row = [string, string, string, number];

const longRows: readonly Row[] = [
  ['TTL1', 'tt_shimen', 'tt_jiaoxi', 23],
  ['TTL2', 'tt_fishermanswharf', 'tt_daxi', 22],
  ['TTL3', 'tt_fulong', 'tt_danhai', 21],
  ['TTL4', 'tt_wulai', 'tt_sanzhi', 18],
  ['TTL5', 'tt_tamsui', 'tt_keelungislet', 18],
  ['TTL6', 'tt_jinshan', 'tt_taoyuan', 17],
  ['TTL7', 'tt_bali', 'tt_shuangxi', 16],
  ['TTL8', 'tt_linkou', 'tt_wanli', 16],
];

const shortRows: readonly Row[] = [
  ['TTS1', 'tt_ankeng', 'tt_pinglin', 8],
  ['TTS2', 'tt_sanzhi', 'tt_yangmingshan', 4],
  ['TTS3', 'tt_fishermanswharf', 'tt_yangmingshan', 7],
  ['TTS4', 'tt_shulin', 'tt_ankeng', 8],
  ['TTS5', 'tt_daan', 'tt_yangmingshan', 8],
  ['TTS6', 'tt_banqiao', 'tt_shuangxi', 11],
  ['TTS7', 'tt_muzha', 'tt_danhai', 12],
  ['TTS8', 'tt_shilin', 'tt_dapinglin', 5],
  ['TTS9', 'tt_sanzhi', 'tt_jinshan', 7],
  ['TTS10', 'tt_sanchong', 'tt_ankeng', 8],
  ['TTS11', 'tt_xinzhuang', 'tt_wulai', 11],
  ['TTS12', 'tt_beitou', 'tt_yingge', 9],
  ['TTS13', 'tt_shilin', 'tt_sanxia', 7],
  ['TTS14', 'tt_linkou', 'tt_shimen', 11],
  ['TTS15', 'tt_xindian', 'tt_xinzhuang', 7],
  ['TTS16', 'tt_shiding', 'tt_keelungislet', 10],
  ['TTS17', 'tt_tucheng', 'tt_yingge', 4],
  ['TTS18', 'tt_keelung', 'tt_pingxi', 6],
  ['TTS19', 'tt_zhonghe', 'tt_shuangxi', 12],
  ['TTS20', 'tt_bali', 'tt_cksmemorial', 8],
  ['TTS21', 'tt_luzhou', 'tt_songshan', 4],
  ['TTS22', 'tt_taipei', 'tt_tamsui', 7],
  ['TTS23', 'tt_xindian', 'tt_yangmingshan', 10],
  ['TTS24', 'tt_tamsui', 'tt_tucheng', 10],
  ['TTS25', 'tt_nangang', 'tt_sanxia', 7],
  ['TTS26', 'tt_yingge', 'tt_muzha', 8],
  ['TTS27', 'tt_dapinglin', 'tt_linkou', 10],
  ['TTS28', 'tt_luzhou', 'tt_pingxi', 9],
  ['TTS29', 'tt_neihu', 'tt_taoyuan', 10],
  ['TTS30', 'tt_dapinglin', 'tt_shiding', 6],
  ['TTS31', 'tt_qidu', 'tt_fulong', 10],
  ['TTS32', 'tt_shulin', 'tt_fishermanswharf', 10],
  ['TTS33', 'tt_neihu', 'tt_jiaoxi', 12],
  ['TTS34', 'tt_banqiao', 'tt_taoyuan', 5],
  ['TTS35', 'tt_taipei', 'tt_sanxia', 5],
  ['TTS36', 'tt_anle', 'tt_pinglin', 9],
  ['TTS37', 'tt_dapinglin', 'tt_shulin', 5],
  ['TTS38', 'tt_beitou', 'tt_sanzhi', 7],
  ['TTS39', 'tt_daan', 'tt_fulong', 12],
  ['TTS40', 'tt_xinzhuang', 'tt_linkou', 4],
  ['TTS41', 'tt_shiding', 'tt_jinshan', 12],
  ['TTS42', 'tt_daan', 'tt_ruifang', 8],
  ['TTS43', 'tt_xinzhuang', 'tt_danhai', 9],
  ['TTS44', 'tt_songshan', 'tt_pinglin', 7],
  ['TTS45', 'tt_shilin', 'tt_yingge', 7],
  ['TTS46', 'tt_beitou', 'tt_sanchong', 5],
  ['TTS47', 'tt_keelung', 'tt_neihu', 7],
  ['TTS48', 'tt_ruifang', 'tt_shimen', 12],
  ['TTS49', 'tt_nangang', 'tt_badouzi', 6],
  ['TTS50', 'tt_keelung', 'tt_dapinglin', 10],
  ['TTS51', 'tt_cksmemorial', 'tt_luzhou', 4],
  ['TTS52', 'tt_wanli', 'tt_daxi', 12],
  ['TTS53', 'tt_sanchong', 'tt_badouzi', 10],
  ['TTS54', 'tt_nangang', 'tt_dapinglin', 5],
  ['TTS55', 'tt_keelung', 'tt_zhonghe', 10],
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

export const TAIPEI_TRANSIT_TICKETS: readonly TicketDef[] = [
  ...longRows.map(toTicket('LONG')),
  ...shortRows.map(toTicket('SHORT')),
];
