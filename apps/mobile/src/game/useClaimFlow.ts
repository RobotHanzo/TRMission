// The claim/tunnel state machine, extracted verbatim from the web GameStage.tsx's inline
// pickRoute/pickCity/confirmPayment/tunnelBase/tunnelExtras code so it is device-independently
// testable and reusable by the offline (P3) and tutorial (P4) stages. Everything money-related is
// derived exclusively from the snapshot, so the offered options always agree with the server's
// validation (sky-lantern +1-card surcharge; gala zero-cost station).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phase, type GameSnapshot } from '@trm/proto';
import type { RouteDef } from '@trm/map-data';
import { routeById } from './content';
import {
  enumerateRoutePayments,
  enumerateStationPayments,
  handAfterPayment,
  handFromCounts,
  paymentToProto,
  routeShortfall,
  stationShortfall,
  type Payment,
} from './payments';
import { enumerateTunnelExtra } from './tunnel';
import { freeStationAvailable, skyLanternSurcharge } from './events';
import { useAnimationsStore } from '../store/animations';
import type { GameCommands } from '../net/commands';

export type Claim =
  | { kind: 'route'; route: RouteDef; payments: Payment[] }
  | { kind: 'station'; cityId: string; payments: Payment[] };

export interface ClaimFlow {
  claim: Claim | null;
  pickRoute(routeId: string): void;
  pickCity(cityId: string): void;
  confirmPayment(p: Payment): void;
  cancelClaim(): void;
  /** The pending tunnel belongs to this viewer (interactive); false = spectate the reveal. */
  tunnelMine: boolean;
  /** Surcharge options against the hand MINUS the stashed base payment (its cards stay in hand
   *  until the tunnel resolves, so they can't be spent twice). */
  tunnelExtras: Payment[];
  onTunnelCommit(p: Payment): void;
  onTunnelAbort(): void;
}

export function useClaimFlow(snapshot: GameSnapshot, commands: GameCommands | null): ClaimFlow {
  const { t } = useTranslation();
  const pushNotification = useAnimationsStore((s) => s.pushNotification);

  const [claim, setClaim] = useState<Claim | null>(null);
  // The base payment committed to a pending tunnel claim. Its cards stay in hand until the tunnel
  // resolves, so the surcharge must be enumerated against the hand minus this.
  const [tunnelBase, setTunnelBase] = useState<Payment | null>(null);

  const me = snapshot.you?.playerId ?? null;
  const myPub = snapshot.players.find((p) => p.id === me);
  const hand = handFromCounts(snapshot.you?.hand);
  const randomEvents = snapshot.randomEvents;

  const pickRoute = (routeId: string): void => {
    const route = routeById.get(routeId);
    if (!route) return;
    const extra = skyLanternSurcharge(randomEvents, routeId);
    const payments = enumerateRoutePayments(hand, route, extra);
    if (payments.length) {
      setClaim({ kind: 'route', route, payments });
      return;
    }
    const s = routeShortfall(hand, route, extra);
    pushNotification({
      variant: 'notice',
      text:
        s.kind === 'locos'
          ? t('insufficientLocos', { need: s.need, have: s.have })
          : t('insufficientCards', { need: s.need, have: s.have }),
    });
  };

  const pickCity = (cityId: string): void => {
    const remaining = myPub?.stationsRemaining ?? 0;
    if (remaining <= 0) {
      pushNotification({ variant: 'notice', text: t('noStationsLeft') });
      return;
    }
    const cost = 3 - remaining + 1;
    const freeStation = freeStationAvailable(randomEvents);
    const payments = enumerateStationPayments(hand, cost, freeStation);
    if (payments.length) {
      setClaim({ kind: 'station', cityId, payments });
      return;
    }
    const s = stationShortfall(hand, cost);
    pushNotification({
      variant: 'notice',
      text: t('insufficientCards', { need: s.need, have: s.have }),
    });
  };

  const confirmPayment = (p: Payment): void => {
    if (!commands || !claim) return;
    if (claim.kind === 'route') {
      if (claim.route.isTunnel) setTunnelBase(p);
      commands.claimRoute(claim.route.id as string, paymentToProto(p));
    } else {
      commands.buildStation(claim.cityId, paymentToProto(p));
    }
    setClaim(null);
  };

  const tunnelMine =
    snapshot.phase === Phase.TUNNEL_PENDING && snapshot.pendingTunnel?.playerId === me;
  const tunnelExtras =
    tunnelMine && snapshot.pendingTunnel
      ? enumerateTunnelExtra(
          tunnelBase ? handAfterPayment(hand, tunnelBase) : hand,
          tunnelBase?.color ?? null,
          snapshot.pendingTunnel.extraRequired,
        )
      : [];

  const onTunnelCommit = (p: Payment): void => {
    commands?.resolveTunnel(true, paymentToProto(p));
    setTunnelBase(null);
  };
  const onTunnelAbort = (): void => {
    commands?.resolveTunnel(false);
    setTunnelBase(null);
  };

  return {
    claim,
    pickRoute,
    pickCity,
    confirmPayment,
    cancelClaim: () => setClaim(null),
    tunnelMine,
    tunnelExtras,
    onTunnelCommit,
    onTunnelAbort,
  };
}
