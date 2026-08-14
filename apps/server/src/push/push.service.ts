import { Inject, Injectable, Logger } from '@nestjs/common';
import { isBotId } from '@trm/bots';
import { UserRepo } from '../auth/user.repo';
import { MetricsService } from '../observability/metrics.service';
import { DeviceRepo } from './device.repo';
import { LiveActivityRepo } from './live-activity.repo';
import {
  PUSH_TRANSPORTS,
  type LiveActivityState,
  type PushMessage,
  type PushTransport,
} from './push.transports';

export type PushKind = 'your_turn' | 'game_started' | 'game_over' | 'game_paused';

/** One seated human whose Live Activity the server has to keep current, plus their own figures. */
export interface LiveActivityRecipient {
  /** The engine player id, which for a human seat IS the account id (`userDevices.userId`). */
  playerId: string;
  seat: number;
  trainCars: number;
  routePoints: number;
}

/** What the hub hands over on a turn change / game end (structurally its own `PushSink` type). */
export interface LiveActivityUpdate {
  gameId: string;
  currentSeat: number;
  finalTurnsRemaining: number;
  over: boolean;
  turnEndsAt: number;
  recipients: LiveActivityRecipient[];
}

type PushLocale = 'zh-Hant' | 'en';

/**
 * Resolves the room code of a game (null when the room is gone / already rematched). Wired from
 * `RoomRepo.findByGameId` by LobbyModule — the module that owns both — because PushModule must
 * not depend on LobbyModule, which imports it. Same "adapt the Nest service into a plain port"
 * idiom as the hub's sinks in game.module.
 */
export type RoomCodeResolver = (gameId: string) => Promise<string | null>;

const STRINGS: Record<PushKind, Record<PushLocale, { title: string; body: string }>> = {
  your_turn: {
    'zh-Hant': { title: '鐵島企劃', body: '輪到你了！' },
    en: { title: 'TRMission', body: "It's your turn!" },
  },
  game_started: {
    'zh-Hant': { title: '鐵島企劃', body: '對局開始了！' },
    en: { title: 'TRMission', body: 'Your game has started!' },
  },
  game_over: {
    'zh-Hant': { title: '鐵島企劃', body: '對局結束了，來看看結果吧！' },
    en: { title: 'TRMission', body: 'The game is over — see the results!' },
  },
  game_paused: {
    'zh-Hant': { title: '鐵島企劃', body: '對局暫停中，等你回來繼續！' },
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
    private readonly liveActivities: LiveActivityRepo,
  ) {}

  get enabled(): boolean {
    return this.transports.length > 0;
  }

  private resolveRoomCode: RoomCodeResolver | null = null;

  /** Injected once by LobbyModule at init; absent = payloads carry whatever the caller passed. */
  setRoomCodeResolver(resolver: RoomCodeResolver): void {
    this.resolveRoomCode = resolver;
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

  /**
   * Fire-and-forget seam for the hub's Live Activity trigger (issue #43) — same posture as the
   * notify wrappers above: a stale Dynamic Island must never be able to disturb the game loop.
   */
  refreshLiveActivities(update: LiveActivityUpdate): void {
    void this.updateLiveActivities(update).catch((e: unknown) =>
      this.log.warn(`live activity update failed: ${(e as Error).message}`),
    );
  }

  /**
   * Push per-recipient Live Activity content to every registered activity for one game.
   *
   * Two things are load-bearing here:
   *  - `recipients` is the hub's list of seated humans with NO live socket. A row whose account is
   *    not in it gets nothing — which is simultaneously the "their own app is updating it" skip and
   *    the hidden-information guard: registering a token against someone else's game buys silence,
   *    not that game's state.
   *  - the content is derived from the RECIPIENT's own row, so two players' cards never carry each
   *    other's figures.
   */
  async updateLiveActivities(
    update: LiveActivityUpdate,
  ): Promise<{ activityCount: number; sent: number; failed: number }> {
    const transport = this.transports.find((t) => t.platform === 'ios');
    const send = transport?.sendLiveActivity?.bind(transport);
    if (!send) return { activityCount: 0, sent: 0, failed: 0 };

    const rows = await this.liveActivities.listForGame(update.gameId);
    if (rows.length === 0) return { activityCount: 0, sent: 0, failed: 0 };

    const byUser = new Map(update.recipients.map((r) => [r.playerId, r]));
    const event = update.over ? 'end' : 'update';
    let sent = 0;
    let failed = 0;
    await Promise.all(
      rows.map(async (row) => {
        const own = byUser.get(row.userId);
        if (!own) return;
        const state: LiveActivityState = {
          currentSeat: update.currentSeat,
          myTrains: own.trainCars,
          myScore: own.routePoints,
          finalTurnsRemaining: update.finalTurnsRemaining,
          over: update.over,
          turnEndsAt: update.turnEndsAt,
        };
        const outcome = await send(row._id, state, event);
        if (outcome === 'ok') {
          sent++;
          this.metrics.pushSent('live_activity');
        } else {
          failed++;
          this.metrics.pushFailed('live_activity');
          if (outcome === 'prune') await this.liveActivities.prune(row._id);
        }
      }),
    );
    // The game is over: every card was just ended, so no row can describe a live activity anymore.
    if (update.over) await this.liveActivities.deleteForGame(update.gameId);
    return { activityCount: rows.length, sent, failed };
  }

  /** Awaitable core (tests await it; the wrappers above are the fire-and-forget seams). */
  async notify(userIds: string[], kind: PushKind, data: Record<string, string>): Promise<void> {
    if (!this.enabled) return;
    try {
      const humans = [...new Set(userIds)].filter((id) => !isBotId(id));
      if (humans.length === 0) return;
      await this.deliver(humans, kind, await this.withRoomCode(data));
    } catch (e) {
      this.log.warn(`push notify failed: ${(e as Error).message}`);
    }
  }

  /**
   * Stamp the room code onto every game payload (issue #63). The mobile client's routes are
   * room-keyed while the hub only ever knows game ids, and `GET /rooms/mine` — the client's own
   * fallback lookup — lists LIVE games only, so a `game_over` tap could never resolve its room
   * after the fact. Resolving here also spares the tap a round trip, which is what makes a
   * cold-start tap land on the game rather than racing the session restore.
   */
  private async withRoomCode(data: Record<string, string>): Promise<Record<string, string>> {
    if (!data.gameId || data.roomCode || !this.resolveRoomCode) return data;
    const code = await this.resolveRoomCode(data.gameId).catch(() => null);
    return code ? { ...data, roomCode: code } : data;
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
