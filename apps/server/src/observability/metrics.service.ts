import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { MetricsHooks } from './hooks';

// Prometheus metrics. trm_security_leak_blocked_total should always be 0 — alert on
// any increase (a hidden-information egress was caught at the wire).
@Injectable()
export class MetricsService implements MetricsHooks {
  readonly registry = new Registry();
  private readonly commands: Counter;
  private readonly rejections: Counter<'code'>;
  private readonly applyDuration: Histogram;
  private readonly connections: Gauge;
  private readonly leaks: Counter;
  private readonly botStalls: Counter<'reason'>;
  private readonly recoveryFailures: Counter;
  private readonly internalErrors: Counter;
  private readonly turnTimeouts: Counter;
  private readonly autoPlayPauses: Counter<'reason'>;
  private readonly roomsPurged: Counter<'trigger' | 'priorStatus'>;
  private readonly gamesPurged: Counter<'trigger' | 'priorStatus'>;
  private readonly pushesSent: Counter<'kind'>;
  private readonly pushesFailed: Counter<'kind'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.commands = new Counter({
      name: 'trm_commands_total',
      help: 'WS game commands received',
      registers: [this.registry],
    });
    this.rejections = new Counter({
      name: 'trm_command_rejections_total',
      help: 'Rejected commands by rule code',
      labelNames: ['code'],
      registers: [this.registry],
    });
    this.applyDuration = new Histogram({
      name: 'trm_command_apply_seconds',
      help: 'Time to validate+apply+fan-out a command',
      buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
      registers: [this.registry],
    });
    this.connections = new Gauge({
      name: 'trm_active_connections',
      help: 'Open WebSocket connections',
      registers: [this.registry],
    });
    this.leaks = new Counter({
      name: 'trm_security_leak_blocked_total',
      help: 'Hidden-info egress blocked',
      registers: [this.registry],
    });
    this.botStalls = new Counter({
      name: 'trm_bot_driver_stalled_total',
      help: 'Bot driver made no progress on a bot turn (should stay 0)',
      labelNames: ['reason'],
      registers: [this.registry],
    });
    this.recoveryFailures = new Counter({
      name: 'trm_game_recovery_failed_total',
      help: 'Persisted games that could not be rehydrated (incompatible engine major or failed replay)',
      registers: [this.registry],
    });
    this.internalErrors = new Counter({
      name: 'trm_ws_internal_errors_total',
      help: 'Inbound WS frames that threw unexpectedly (should stay 0)',
      registers: [this.registry],
    });
    this.turnTimeouts = new Counter({
      name: 'trm_turn_timeouts_total',
      help: 'Turns whose per-turn timer lapsed and were auto-played by the server',
      registers: [this.registry],
    });
    this.autoPlayPauses = new Counter({
      name: 'trm_game_autoplay_paused_total',
      help: 'Games marked inactive (per-turn auto-play suspended), by reason',
      labelNames: ['reason'],
      registers: [this.registry],
    });
    this.roomsPurged = new Counter({
      name: 'trm_rooms_purged_total',
      help: 'Rooms deleted, by trigger and prior status',
      labelNames: ['trigger', 'priorStatus'],
      registers: [this.registry],
    });
    this.gamesPurged = new Counter({
      name: 'trm_games_purged_total',
      help: 'Games deleted, by trigger and prior status',
      labelNames: ['trigger', 'priorStatus'],
      registers: [this.registry],
    });
    this.pushesSent = new Counter({
      name: 'trm_push_sent_total',
      help: 'Push notifications delivered to a platform gateway, by kind',
      labelNames: ['kind'],
      registers: [this.registry],
    });
    this.pushesFailed = new Counter({
      name: 'trm_push_failed_total',
      help: 'Push notification sends that failed or hit a dead token, by kind',
      labelNames: ['kind'],
      registers: [this.registry],
    });
  }

  commandReceived(): void {
    this.commands.inc();
  }
  commandRejected(code: string): void {
    this.rejections.inc({ code });
  }
  commandApplied(seconds: number): void {
    this.applyDuration.observe(seconds);
  }
  connectionOpened(): void {
    this.connections.inc();
  }
  connectionClosed(): void {
    this.connections.dec();
  }
  leakBlocked(): void {
    this.leaks.inc();
  }
  botDriverStalled(reason: 'no_legal_action' | 'persist_failed'): void {
    this.botStalls.inc({ reason });
  }
  recoveryFailed(): void {
    this.recoveryFailures.inc();
  }
  internalError(): void {
    this.internalErrors.inc();
  }
  turnTimedOut(): void {
    this.turnTimeouts.inc();
  }
  autoPlayPaused(reason: 'afk_streak' | 'no_humans_connected'): void {
    this.autoPlayPauses.inc({ reason });
  }
  roomPurged(trigger: 'auto' | 'manual', priorStatus: string): void {
    this.roomsPurged.inc({ trigger, priorStatus });
  }
  gamePurged(trigger: 'auto' | 'manual', priorStatus: string): void {
    this.gamesPurged.inc({ trigger, priorStatus });
  }
  pushSent(kind: string): void {
    this.pushesSent.inc({ kind });
  }
  pushFailed(kind: string): void {
    this.pushesFailed.inc({ kind });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
  get contentType(): string {
    return this.registry.contentType;
  }
}
