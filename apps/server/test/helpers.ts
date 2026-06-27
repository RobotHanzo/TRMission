// Test-only helpers: encode an engine Action as a proto client command (the inverse
// of the server's command codec) so tests can drive the hub over real bytes.
import { create, toBinary, fromBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  ClientEnvelopeSchema,
  ServerEnvelopeSchema,
  type ClientEnvelope,
  type ServerEnvelope,
} from '@trm/proto';
import type { Action, Payment } from '@trm/engine';
import { cardOrNullToPb } from '../src/codec';

type Command = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;

const paymentToPb = (p: Payment) => ({
  color: cardOrNullToPb(p.color),
  colorCount: p.colorCount,
  locomotives: p.locomotives,
});

export function actionToCommand(action: Action): Command {
  switch (action.t) {
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
