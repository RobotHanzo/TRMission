import { Inject, Injectable, Logger } from '@nestjs/common';
import { isBotId } from '../bots/types';
import { UserRepo } from '../auth/user.repo';
import { MetricsService } from '../observability/metrics.service';
import { DeviceRepo } from './device.repo';
import { PUSH_TRANSPORTS, type PushMessage, type PushTransport } from './push.transports';

export type PushKind = 'your_turn' | 'game_started' | 'game_over';

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

  /** Awaitable core (tests await it; the wrappers above are the fire-and-forget seams). */
  async notify(userIds: string[], kind: PushKind, data: Record<string, string>): Promise<void> {
    if (!this.enabled) return;
    try {
      const humans = [...new Set(userIds)].filter((id) => !isBotId(id));
      if (humans.length === 0) return;
      const rows = await this.devices.listForUsers(humans);
      if (rows.length === 0) return;

      const locales = new Map<string, PushLocale>();
      for (const id of humans) {
        const u = await this.users.findById(id);
        locales.set(id, u?.preferences?.locale === 'en' ? 'en' : 'zh-Hant');
      }

      await Promise.all(
        rows.map(async (row) => {
          const transport = this.transports.find((t) => t.platform === row.platform);
          if (!transport) return;
          const s = STRINGS[kind][locales.get(row.userId) ?? 'zh-Hant'];
          const msg: PushMessage = { title: s.title, body: s.body, data: { kind, ...data } };
          const outcome = await transport.send(row._id, msg);
          if (outcome === 'ok') {
            this.metrics.pushSent(kind);
          } else {
            this.metrics.pushFailed(kind);
            if (outcome === 'prune') await this.devices.prune(row._id);
          }
        }),
      );
    } catch (e) {
      this.log.warn(`push notify failed: ${(e as Error).message}`);
    }
  }
}
