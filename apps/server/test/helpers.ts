// Test-only helpers: encode an engine Action as a proto client command (the inverse
// of the server's command codec) so tests can drive the hub over real bytes.
import { create, toBinary, fromBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  type ClientEnvelope,
  type ServerEnvelope,
  BentoSpend,
  EventPerk,
} from '@trm/proto';
import { legalActions } from '@trm/engine';
import type { Action, Payment, Board, GameState } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import { cardOrNullToPb } from '@trm/codec';

type Command = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;

const paymentToPb = (p: Payment) => ({
  color: cardOrNullToPb(p.color),
  colorCount: p.colorCount,
  locomotives: p.locomotives,
  bentoSpend:
    p.bentoSpend === 'WILD'
      ? BentoSpend.WILD
      : p.bentoSpend === 'POINTS'
        ? BentoSpend.POINTS
        : BentoSpend.UNSPECIFIED,
  useClaimDiscount: p.useClaimDiscount ?? false,
});

export function actionToCommand(action: Action): Command {
  switch (action.t) {
    case 'END_GAME':
      throw new Error('END_GAME is server-authorized and has no client protobuf command');
    case 'KEEP_INITIAL_TICKETS':
      return { case: 'keepInitialTickets', value: { ticketIds: action.keep.map(String) } };
    case 'DRAW_BLIND':
      return { case: 'drawBlind', value: {} };
    case 'DRAW_FACEUP':
      return { case: 'drawFaceup', value: { slot: action.slot } };
    case 'DRAW_TICKETS':
      return { case: 'drawTickets', value: {} };
    case 'KEEP_TICKETS':
      return { case: 'keepTickets', value: { ticketIds: action.keep.map(String) } };
    case 'CLAIM_ROUTE':
      return {
        case: 'claimRoute',
        value: { routeId: action.routeId as string, payment: paymentToPb(action.payment) },
      };
    case 'BUILD_STATION':
      return {
        case: 'buildStation',
        value: { cityId: action.cityId as string, payment: paymentToPb(action.payment) },
      };
    case 'RESOLVE_TUNNEL':
      return action.commit
        ? {
            case: 'resolveTunnel',
            value: {
              commit: true,
              extra: paymentToPb(action.extra ?? { color: null, colorCount: 0, locomotives: 0 }),
            },
          }
        : { case: 'resolveTunnel', value: { commit: false } };
    case 'RELOCATE_LANTERN_HOST':
      return { case: 'relocateLanternHost', value: { cityId: action.cityId as string } };
    case 'REPAIR_ROUTE':
      return {
        case: 'repairRoute',
        value: { routeId: action.routeId as string, payment: paymentToPb(action.payment) },
      };
    case 'NIGHT_MARKET_SWAP':
      return {
        case: 'nightMarketSwap',
        value: { giveColor: cardOrNullToPb(action.giveColor), slot: action.slot },
      };
    case 'CHOOSE_EVENT_PERK':
      return {
        case: 'chooseEventPerk',
        value: {
          perk:
            action.perk === 'CLAIM_DISCOUNT'
              ? EventPerk.CLAIM_DISCOUNT
              : action.perk === 'DRAW_TWO'
                ? EventPerk.DRAW_TWO
                : EventPerk.REPAIR_PERMIT,
        },
      };
    case 'START_HIVE_DRAW':
      return { case: 'startHiveDraw', value: {} };
    case 'CONTINUE_HIVE_DRAW':
      return { case: 'continueHiveDraw', value: {} };
    case 'STOP_HIVE_DRAW':
      return { case: 'stopHiveDraw', value: {} };
    case 'PUSH_TO_TEAM_POOL':
      return { case: 'pushToTeamPool', value: { color: cardOrNullToPb(action.color) } };
    case 'TAKE_FROM_TEAM_POOL':
      return { case: 'takeFromTeamPool', value: { color: cardOrNullToPb(action.color) } };
    case 'PASS':
      return { case: 'pass', value: {} };
  }
}

export const encodeClient = (clientSeq: number, command: Command): Uint8Array =>
  toBinary(ClientEnvelopeSchema, create(ClientEnvelopeSchema, { clientSeq, command }));

export const decodeClient = (bytes: Uint8Array): ClientEnvelope =>
  fromBinary(ClientEnvelopeSchema, bytes);

export const decodeServer = (bytes: Uint8Array): ServerEnvelope =>
  fromBinary(ServerEnvelopeSchema, bytes);

type ClaimAction = Extract<Action, { t: 'CLAIM_ROUTE' }>;

/**
 * Deterministic driver shared by the e2e specs: prefer claiming the longest affordable
 * NON-TUNNEL route (drains trains toward the endgame without the tunnel reveal/commit
 * branch), else draw, draw tickets, build, or pass. Here we just need games that run to
 * completion; the individual mechanics have their own engine tests.
 *
 * Tunnels are still resolved when forced: a pending tunnel commits when the surcharge is
 * affordable (else aborts), and a tunnel is claimed as a last resort once the board is down
 * to tunnels and the deck is dry — otherwise a sparse late game can livelock with no PASS
 * available (PASS is legal only when no other move is).
 */
export function pickAction(board: Board, state: GameState, player: PlayerId): Action {
  const legal = legalActions(board, state, player);
  if (legal.length === 0) throw new Error(`no legal action for ${player}`);

  if (state.turn.phase === 'TUNNEL_PENDING') {
    return (
      legal.find((a) => a.t === 'RESOLVE_TUNNEL' && a.commit) ??
      legal.find((a) => a.t === 'RESOLVE_TUNNEL') ??
      (legal[0] as Action)
    );
  }

  if (state.turn.phase === 'AWAIT_ACTION') {
    const byLongest = (a: ClaimAction, b: ClaimAction): number => {
      const la = board.routeById.get(a.routeId as string)?.length ?? 0;
      const lb = board.routeById.get(b.routeId as string)?.length ?? 0;
      return lb - la || (a.routeId as string).localeCompare(b.routeId as string);
    };
    const claims = legal.filter((a): a is ClaimAction => a.t === 'CLAIM_ROUTE');
    const nonTunnel = claims.filter(
      (a) => board.routeById.get(a.routeId as string)?.isTunnel !== true,
    );
    if (nonTunnel.length > 0) return [...nonTunnel].sort(byLongest)[0] as Action;
    for (const t of ['DRAW_BLIND', 'DRAW_TICKETS', 'BUILD_STATION', 'PASS'] as const) {
      const hit = legal.find((a) => a.t === t);
      if (hit) return hit;
    }
    // Board down to tunnels and the deck is dry: claim a tunnel to keep draining trains.
    if (claims.length > 0) return [...claims].sort(byLongest)[0] as Action;
  }
  return legal[0] as Action;
}
