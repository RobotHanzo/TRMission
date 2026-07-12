import type { PaymentInit, CameraViewInit } from './socket';

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
  pass(): void;
  /** Cosmetic camera-framing broadcast; a no-op in the local sandbox. */
  cameraUpdate(view: CameraViewInit): void;
}
