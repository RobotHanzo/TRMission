// GameCommands over the LOCAL engine — the mobile analogue of the web's SandboxSocket
// (apps/web/src/net/sandboxSocket.ts): stage commands go through the shared codec's
// commandToAction, so they travel the identical command→action mapping as the wire, then
// land in the offline session via the callback (which owns apply + projection + bots).
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ClientEnvelopeSchema, EventPerk as PbEventPerk } from '@trm/proto';
import { commandToAction, cardToPb } from '@trm/codec';
import type { Action } from '@trm/engine';
import type { CardColor, PlayerId } from '@trm/shared';
import type { EventPerkChoice, GameCommands } from '../net/commands';
import type { PaymentInit, CameraViewInit } from '../net/socket';

type CommandInit = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;

export class LocalSocket implements GameCommands {
  constructor(
    private readonly humanId: PlayerId,
    private readonly onAction: (action: Action) => void,
  ) {}

  private send(command: CommandInit): void {
    const env = create(ClientEnvelopeSchema, { command });
    const action = commandToAction(env.command, this.humanId);
    if (action) this.onAction(action);
  }

  keepInitialTickets(ticketIds: string[]): void {
    this.send({ case: 'keepInitialTickets', value: { ticketIds } });
  }
  keepTickets(ticketIds: string[]): void {
    this.send({ case: 'keepTickets', value: { ticketIds } });
  }
  drawBlind(): void {
    this.send({ case: 'drawBlind', value: {} });
  }
  drawFaceUp(slot: number): void {
    this.send({ case: 'drawFaceup', value: { slot } });
  }
  drawTickets(): void {
    this.send({ case: 'drawTickets', value: {} });
  }
  claimRoute(routeId: string, payment: PaymentInit): void {
    this.send({ case: 'claimRoute', value: { routeId, payment } });
  }
  buildStation(cityId: string, payment: PaymentInit): void {
    this.send({ case: 'buildStation', value: { cityId, payment } });
  }
  resolveTunnel(commit: boolean, extra?: PaymentInit): void {
    this.send({ case: 'resolveTunnel', value: commit ? { commit, extra } : { commit } });
  }
  relocateLanternHost(cityId: string): void {
    this.send({ case: 'relocateLanternHost', value: { cityId } });
  }
  repairRoute(routeId: string, payment: PaymentInit): void {
    this.send({ case: 'repairRoute', value: { routeId, payment } });
  }
  nightMarketSwap(giveColor: CardColor, slot: number): void {
    this.send({ case: 'nightMarketSwap', value: { giveColor: cardToPb(giveColor), slot } });
  }
  chooseEventPerk(perk: EventPerkChoice): void {
    const value =
      perk === 'CLAIM_DISCOUNT'
        ? PbEventPerk.CLAIM_DISCOUNT
        : perk === 'DRAW_TWO'
          ? PbEventPerk.DRAW_TWO
          : PbEventPerk.REPAIR_PERMIT;
    this.send({ case: 'chooseEventPerk', value: { perk: value } });
  }
  startHiveDraw(): void {
    this.send({ case: 'startHiveDraw', value: {} });
  }
  continueHiveDraw(): void {
    this.send({ case: 'continueHiveDraw', value: {} });
  }
  stopHiveDraw(): void {
    this.send({ case: 'stopHiveDraw', value: {} });
  }
  pushToTeamPool(color: CardColor): void {
    this.send({ case: 'pushToTeamPool', value: { color: cardToPb(color) } });
  }
  takeFromTeamPool(color: CardColor): void {
    this.send({ case: 'takeFromTeamPool', value: { color: cardToPb(color) } });
  }
  pass(): void {
    this.send({ case: 'pass', value: {} });
  }
  cameraUpdate(_view: CameraViewInit): void {
    /* no-op offline: nobody to relay framing to */
  }
}
