// The offline mirror of the server's authoritative loop (apps/server/src/game/game-session.ts
// + the bot driver in apps/server/src/ws/hub.ts): the REAL engine runs locally, every
// accepted action is appended to the event-sourced local log BEFORE being committed to
// memory (the hub's write-ahead order), and the UI only ever sees the SAME projection the
// wire uses — redactFor(human) → viewToSnapshot. Bots are ordinary seated players chosen
// by @trm/bots, identical to the server driver, and their moves are logged like any other.
//
// Divergence from server semantics, both deliberate (spec §4):
//  - resume() TRUNCATES a corrupt tail and continues (server recovery aborts) — an offline
//    game must never crash into a corrupt save.
//  - a failed append flips persistenceBroken and STOPS persisting (no gaps in the log),
//    but the in-memory game keeps going — the UI shows a "can't save" banner.
import { chooseBotAction, isBotId } from '@trm/bots';
import type { BotProfile } from '@trm/bots';
import { currentPlayerId, initGame, reduce, redactFor, stateDigest } from '@trm/engine';
import type { Action, Board, GameEvent, GameState, Phase } from '@trm/engine';
import { asPlayerId } from '@trm/shared';
import type { PlayerId, RuleViolation } from '@trm/shared';
import { eventToProto, viewToSnapshot } from '@trm/codec';
import type { GameSnapshot, GameEvent as PbGameEvent } from '@trm/proto';
import type { LocalGameStorePort, OfflineGameSetup, StoredActionRow } from './types';

export type LocalApplyResult =
  | { readonly ok: true; readonly events: GameEvent[] }
  | { readonly ok: false; readonly violation: RuleViolation };

export type BotStepResult =
  | { readonly kind: 'moved'; readonly profile: BotProfile; readonly events: GameEvent[] }
  | { readonly kind: 'idle' } // waiting on the human
  | { readonly kind: 'gameOver' };

export interface ResumeReport {
  /** First seq of the discarded corrupt tail, or null when the whole log verified. */
  readonly discardedFromSeq: number | null;
}

function humanOf(setup: OfflineGameSetup): PlayerId {
  const human = setup.config.players.find((p) => !isBotId(p.id as string));
  if (!human) throw new Error('offline setup has no human seat');
  return human.id;
}

export class LocalGameSession {
  private state: GameState;
  /** True once an append failed; we keep playing in memory but stop persisting entirely. */
  persistenceBroken = false;

  private constructor(
    readonly setup: OfflineGameSetup,
    readonly board: Board,
    private readonly store: LocalGameStorePort,
    readonly humanId: PlayerId,
  ) {
    this.state = initGame(board, setup.config);
  }

  /** Create + persist a brand-new offline game (genesis row before the first move). */
  static async create(
    setup: OfflineGameSetup,
    board: Board,
    store: LocalGameStorePort,
  ): Promise<LocalGameSession> {
    const s = new LocalGameSession(setup, board, store, humanOf(setup));
    await store.createGame(setup, stateDigest(s.state));
    return s;
  }

  /**
   * Rebuild from the stored log, digest-verifying every step (GameSession.restore idiom).
   * On the first rejected action, digest mismatch, or seq gap, the tail is DISCARDED
   * (store.discardTail) and play resumes from the last good state. Also returns the
   * re-derived redacted event history for log backfill (GameSession.history idiom —
   * events are deterministic, so nothing extra is ever persisted).
   */
  static async resume(
    setup: OfflineGameSetup,
    board: Board,
    store: LocalGameStorePort,
    actions: readonly StoredActionRow[],
  ): Promise<{ session: LocalGameSession; report: ResumeReport; history: PbGameEvent[] }> {
    const s = new LocalGameSession(setup, board, store, humanOf(setup));
    const history: PbGameEvent[] = [];
    let discardedFromSeq: number | null = null;
    for (const row of actions) {
      const r = reduce(board, s.state, row.action);
      if (
        !r.ok ||
        r.value.state.actionSeq !== row.seq ||
        stateDigest(r.value.state) !== row.stateDigest
      ) {
        discardedFromSeq = row.seq;
        break;
      }
      s.state = r.value.state;
      history.push(...s.redactEvents(r.value.events));
    }
    if (discardedFromSeq !== null) await store.discardTail(setup.gameId, discardedFromSeq);
    return { session: s, report: { discardedFromSeq }, history };
  }

  get phase(): Phase {
    return this.state.turn.phase;
  }
  get stateVersion(): number {
    return this.state.actionSeq;
  }
  get isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }
  get currentPlayer(): PlayerId | null {
    return this.isGameOver ? null : currentPlayerId(this.state);
  }

  /** Full engine state — bot driving + tests ONLY. Never hand this to the UI. */
  raw(): GameState {
    return this.state;
  }

  /** Reduce → append (write-ahead) → commit. Same order as the hub; see class doc for the
   *  persistence-failure divergence. */
  async apply(action: Action): Promise<LocalApplyResult> {
    const r = reduce(this.board, this.state, action);
    if (!r.ok) return { ok: false, violation: r.error };
    const next = r.value.state;
    if (!this.persistenceBroken) {
      try {
        await this.store.appendAction(this.setup.gameId, {
          seq: next.actionSeq,
          action,
          stateDigest: stateDigest(next),
        });
      } catch {
        this.persistenceBroken = true;
      }
    }
    this.state = next;
    if (this.isGameOver && !this.persistenceBroken) {
      try {
        await this.store.markCompleted(this.setup.gameId);
      } catch {
        this.persistenceBroken = true;
      }
    }
    return { ok: true, events: [...r.value.events] };
  }

  /** Port of the hub's nextActableBot: the first bot with a decision available right now. */
  nextActableBot(): BotProfile | null {
    const phase = this.phase;
    const current = this.currentPlayer;
    const tunnelPlayer = this.state.pendingTunnel?.playerId ?? null;
    for (const profile of this.setup.bots) {
      const pid = asPlayerId(profile.playerId);
      const pendingOffer = this.state.players[profile.playerId]?.pendingTicketOffer != null;
      if (phase === 'SETUP_TICKETS') {
        if (pendingOffer) return profile;
      } else if (phase === 'TICKET_SELECTION') {
        if (current === pid && pendingOffer) return profile;
      } else if (phase === 'TUNNEL_PENDING') {
        if (tunnelPlayer === pid) return profile;
      } else if (current === pid) {
        return profile; // AWAIT_ACTION / DRAWING_CARDS
      }
    }
    return null;
  }

  /** One bot move through the same apply() path as the human (logged identically). */
  async botStep(): Promise<BotStepResult> {
    if (this.isGameOver) return { kind: 'gameOver' };
    const profile = this.nextActableBot();
    if (!profile) return { kind: 'idle' };
    const botId = asPlayerId(profile.playerId);
    const chosen = chooseBotAction(this.board, this.state, botId, profile.difficulty);
    // legalActions guarantees PASS whenever nothing else is legal — mirror the hub's fallback.
    const action: Action = chosen ?? { t: 'PASS', player: botId };
    const res = await this.apply(action);
    if (!res.ok) {
      const pass = await this.apply({ t: 'PASS', player: botId });
      return pass.ok ? { kind: 'moved', profile, events: pass.events } : { kind: 'idle' };
    }
    return { kind: 'moved', profile, events: res.events };
  }

  /** The human's redacted snapshot — the ONLY projection the UI ever sees. */
  projectHuman(): GameSnapshot {
    const view = redactFor(this.board, this.state, this.humanId);
    return viewToSnapshot(view, this.state.actionSeq, this.humanId);
  }

  /** Redacted proto events for the human viewer (animations + action log). */
  redactEvents(events: readonly GameEvent[]): PbGameEvent[] {
    return events
      .map((e) => eventToProto(e, this.humanId))
      .filter((e): e is PbGameEvent => e !== null);
  }
}
