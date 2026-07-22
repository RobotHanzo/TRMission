import type { PaymentInit, CameraViewInit } from './socket';
import type { CardColor } from '@trm/shared';

export type EventPerkChoice = 'CLAIM_DISCOUNT' | 'DRAW_TWO' | 'REPAIR_PERMIT';

/**
 * The command surface the in-game board + HUD (`GameStage`) drive. The live `GameSocket` (sends
 * protobuf frames to the server) and the local `SandboxSocket` (applies actions to a local engine
 * for the tutorial / encyclopedia) both satisfy it structurally, so the same components render and
 * act on either without knowing which is behind them.
 */
export interface GameCommands {
  keepInitialTickets(ticketIds: string[]): void;
  keepTickets(ticketIds: string[]): void;
  drawBlind(): void;
  drawFaceUp(slot: number): void;
  drawTickets(): void;
  claimRoute(routeId: string, payment: PaymentInit): void;
  buildStation(cityId: string, payment: PaymentInit): void;
  resolveTunnel(commit: boolean, extra?: PaymentInit): void;
  relocateLanternHost(cityId: string): void;
  repairRoute(routeId: string, payment: PaymentInit): void;
  nightMarketSwap(giveColor: CardColor, slot: number): void;
  chooseEventPerk(perk: EventPerkChoice): void;
  startHiveDraw(): void;
  continueHiveDraw(): void;
  stopHiveDraw(): void;
  /** Team game: move one card from hand into the team pool (free, once per turn). */
  pushToTeamPool(color: CardColor): void;
  /** Team game: take one card out of the team pool (counts as a draw). */
  takeFromTeamPool(color: CardColor): void;
  pass(): void;
  /** Cosmetic camera-framing broadcast; a no-op in the local sandbox. */
  cameraUpdate(view: CameraViewInit): void;
}
