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

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
  get contentType(): string {
    return this.registry.contentType;
  }
}
