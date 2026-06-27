// Proto client command → engine Action, bound to the authenticated player (the
// server NEVER trusts a player id from the wire — it comes from the socket's
// ClientHello binding). Non-game frames (hello/resync/chat/ping) return null and
// are handled by the dispatcher directly.
import { asRouteId, asCityId, asTicketId } from '@trm/shared';
import type { PlayerId } from '@trm/shared';
import type { Action, Payment as EnginePayment } from '@trm/engine';
import type { ClientEnvelope, Payment as PbPayment } from '@trm/proto';
import { pbToTrainColorOrNull } from './enums';

type Command = ClientEnvelope['command'];

const protoPayment = (p: PbPayment | undefined): EnginePayment => ({
  color: p ? pbToTrainColorOrNull(p.color) : null,
  colorCount: p?.colorCount ?? 0,
  locomotives: p?.locomotives ?? 0,
});

export function commandToAction(command: Command, player: PlayerId): Action | null {
  switch (command.case) {
    case 'keepInitialTickets':
      return { t: 'KEEP_INITIAL_TICKETS', player, keep: command.value.ticketIds.map(asTicketId) };
    case 'drawBlind':
      return { t: 'DRAW_BLIND', player };
    case 'drawFaceup':
      return { t: 'DRAW_FACEUP', player, slot: command.value.slot };
    case 'drawTickets':
      return { t: 'DRAW_TICKETS', player };
    case 'keepTickets':
      return { t: 'KEEP_TICKETS', player, keep: command.value.ticketIds.map(asTicketId) };
    case 'claimRoute':
      return {
        t: 'CLAIM_ROUTE',
        player,
        routeId: asRouteId(command.value.routeId),
        payment: protoPayment(command.value.payment),
      };
    case 'buildStation':
      return {
        t: 'BUILD_STATION',
        player,
        cityId: asCityId(command.value.cityId),
        payment: protoPayment(command.value.payment),
      };
    case 'resolveTunnel':
      return command.value.commit
        ? { t: 'RESOLVE_TUNNEL', player, commit: true, extra: protoPayment(command.value.extra) }
        : { t: 'RESOLVE_TUNNEL', player, commit: false };
    case 'pass':
      return { t: 'PASS', player };
    default:
      return null; // hello / resync / chat / ping / unset
  }
}
