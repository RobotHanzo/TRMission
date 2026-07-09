// A local, server-less driver that runs a REAL @trm/engine game and projects it — through the
// shared @trm/codec — into the SAME stores the live game uses, so the existing board + HUD render it
// unchanged. It powers the interactive tutorial (the learner's moves go through `reduce`, which
// validates them exactly like the server) and the encyclopedia replays (scripted `auto` actions).
// No network I/O. Learner commands are mapped through the codec's `commandToAction`, so they travel
// the identical command→action path as the wire.
import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { ClientEnvelopeSchema } from '@trm/proto';
import type { GameSnapshot, GameEvent as PbGameEvent } from '@trm/proto';
import { initGame, reduce, redactFor } from '@trm/engine';
import type { Action, Board, GameConfig, GameState, GameEvent, ReduceOutput } from '@trm/engine';
import type { PlayerId } from '@trm/shared';
import { viewToSnapshot, eventToProto, commandToAction } from '@trm/codec';
import type { PaymentInit, CameraViewInit } from './socket';
import type { GameCommands } from './commands';
import type { RejectionInfo } from '../store/game';

type CommandInit = NonNullable<MessageInitShape<typeof ClientEnvelopeSchema>['command']>;

export interface SandboxPorts {
  applySnapshot(snapshot: GameSnapshot): void;
  applyEvents(stateVersion: number, events: PbGameEvent[]): void;
  setRejection?(rejection: RejectionInfo | null): void;
  /** Fired after every successfully applied action (learner OR scripted) — the scenario player
   *  listens here to detect when the learner has performed the highlighted move. */
  onAction?(action: Action, out: ReduceOutput): void;
}

export class SandboxSocket implements GameCommands {
  private state: GameState;

  constructor(
    private readonly board: Board,
    config: GameConfig,
    private readonly viewer: PlayerId,
    private readonly ports: SandboxPorts,
    prefix: readonly Action[] = [],
  ) {
    this.state = initGame(board, config);
    for (const action of prefix) {
      const r = reduce(board, this.state, action);
      if (!r.ok) throw new Error(`sandbox prefix action ${action.t} rejected: ${r.error.code}`);
      this.state = r.value.state;
    }
    this.project([]);
  }

  /** The full engine state — for checkpoints, scripting (reading hidden offers), and assertions. */
  getState(): GameState {
    return this.state;
  }

  /** The static board content — pairs with `getState()` for scripting engine-level actions. */
  getBoard(): Board {
    return this.board;
  }

  /** Apply a scripted action (a bot move or a demo beat) carrying its own `player`. */
  auto(action: Action): boolean {
    return this.dispatch(action);
  }

  private dispatch(action: Action): boolean {
    const r = reduce(this.board, this.state, action);
    if (!r.ok) {
      this.ports.setRejection?.({ code: 0, messageKey: 'actionRejected' });
      return false;
    }
    this.state = r.value.state;
    this.project(r.value.events);
    this.ports.onAction?.(action, r.value);
    return true;
  }

  private project(events: readonly GameEvent[]): void {
    const view = redactFor(this.board, this.state, this.viewer);
    this.ports.applySnapshot(viewToSnapshot(view, this.state.actionSeq, this.viewer));
    if (events.length > 0) {
      const pb = events
        .map((e) => eventToProto(e, this.viewer))
        .filter((e): e is PbGameEvent => e !== null);
      if (pb.length > 0) this.ports.applyEvents(this.state.actionSeq, pb);
    }
  }

  /** Learner command → engine action via the shared codec (identical mapping to the wire). */
  private send(command: CommandInit): void {
    const env = create(ClientEnvelopeSchema, { command });
    const action = commandToAction(env.command, this.viewer);
    if (action) this.dispatch(action);
  }

  // ── GameCommands (bodies mirror GameSocket, but route to the local engine) ──
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
  pass(): void {
    this.send({ case: 'pass', value: {} });
  }
  cameraUpdate(_view: CameraViewInit): void {
    /* no-op: the sandbox board suppresses camera broadcast */
  }
}
