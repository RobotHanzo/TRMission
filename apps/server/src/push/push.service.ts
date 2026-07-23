import { Inject, Injectable, Logger } from '@nestjs/common';
import { isBotId } from '@trm/bots';
import { UserRepo } from '../auth/user.repo';
import { MetricsService } from '../observability/metrics.service';
import { DeviceRepo } from './device.repo';
import { PUSH_TRANSPORTS, type PushMessage, type PushTransport } from './push.transports';

export type PushKind = 'your_turn' | 'game_started' | 'game_over' | 'game_paused';

type PushLocale = 'zh-Hant' | 'en';

const STRINGS: Record<PushKind, Record<PushLocale, { title: string; body: string }>> = {
  your_turn: {
    'zh-Hant': { title: '台鐵任務', body: '輪到你了！' },
    en: { title: 'TRMission', body: "It's your turn!" },
  },
  game_started: {
    'zh-Hant': { title: '台鐵任務', body: '對局開始了！' },
    en: { title: 'TRMission', body: 'Your game has started!' },
  },
  game_over: {
    'zh-Hant': { title: '台鐵任務', body: '對局結束了，來看看結果吧！' },
    en: { title: 'TRMission', body: 'The game is over — see the results!' },
  },
  game_paused: {
    'zh-Hant': { title: '台鐵任務', body: '對局暫停中，等你回來繼續！' },
    en: { title: 'TRMission', body: 'Your game is paused — come back to resume!' },
  },
};

/**
 * Push fan-out: resolves a user set to device rows, localizes per account preference,
 * sends through whichever platform transports are configured (none = fully disabled),
 * prunes tokens the platforms declare dead, and never throws — every caller is a
 * fire-and-forget seam inside game-critical paths.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('PushService');

  constructor(
    private readonly devices: DeviceRepo,
    private readonly users: UserRepo,
    private readonly metrics: MetricsService,
    @Inject(PUSH_TRANSPORTS) private readonly transports: PushTransport[],
  ) {}

  get enabled(): boolean {
    return this.transports.length > 0;
  }

  notifyYourTurn(gameId: string, playerId: string): void {
    void this.notify([playerId], 'your_turn', { gameId });
  }

  notifyGameStarted(userIds: string[], gameId: string, roomCode: string): void {
    void this.notify(userIds, 'game_started', { gameId, roomCode });
  }

  notifyGameOver(gameId: string, userIds: string[]): void {
    void this.notify(userIds, 'game_over', { gameId });
  }

  notifyGamePaused(gameId: string, userIds: string[]): void {
    void this.notify(userIds, 'game_paused', { gameId });
  }

  /** Awaitable core (tests await it; the wrappers above are the fire-and-forget seams). */
  async notify(userIds: string[], kind: PushKind, data: Record<string, string>): Promise<void> {
    if (!this.enabled) return;
    try {
      const humans = [...new Set(userIds)].filter((id) => !isBotId(id));
      if (humans.length === 0) return;
      await this.deliver(humans, kind, data);
    } catch (e) {
      this.log.warn(`push notify failed: ${(e as Error).message}`);
    }
  }

  /**
   * Dashboard "send test push" (`dashboard-push.controller.ts`): fires the same real,
   * localized delivery path as `notify`, but reports the outcome instead of swallowing it —
   * an operator needs to tell "push disabled" from "no devices" from "sent to N of M".
   */
  async sendTest(
    userId: string,
    kind: PushKind,
  ): Promise<{ enabled: boolean; deviceCount: number; sent: number; failed: number }> {
    if (!this.enabled) return { enabled: false, deviceCount: 0, sent: 0, failed: 0 };
    const { deviceCount, sent, failed } = await this.deliver([userId], kind, { test: '1' });
    return { enabled: true, deviceCount, sent, failed };
  }

  private async deliver(
    userIds: string[],
    kind: PushKind,
    data: Record<string, string>,
  ): Promise<{ deviceCount: number; sent: number; failed: number }> {
    const rows = await this.devices.listForUsers(userIds);
    if (rows.length === 0) return { deviceCount: 0, sent: 0, failed: 0 };

    const locales = new Map<string, PushLocale>();
    for (const id of userIds) {
      const u = await this.users.findById(id);
      locales.set(id, u?.preferences?.locale === 'en' ? 'en' : 'zh-Hant');
    }

    let sent = 0;
    let failed = 0;
    await Promise.all(
      rows.map(async (row) => {
        const transport = this.transports.find((t) => t.platform === row.platform);
        if (!transport) {
          failed++;
          return;
        }
        const s = STRINGS[kind][locales.get(row.userId) ?? 'zh-Hant'];
        const msg: PushMessage = { title: s.title, body: s.body, data: { kind, ...data } };
        const outcome = await transport.send(row._id, msg);
        if (outcome === 'ok') {
          sent++;
          this.metrics.pushSent(kind);
        } else {
          failed++;
          this.metrics.pushFailed(kind);
          if (outcome === 'prune') await this.devices.prune(row._id);
        }
      }),
    );
    return { deviceCount: rows.length, sent, failed };
  }
}
