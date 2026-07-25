import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taiwanBoard, CONTENT_HASH, type GameConfig, type PlayerSeed } from '@trm/engine';
import { asPlayerId, TELEMETRY_REDACTED, type SeatIndex } from '@trm/shared';
import type { BotProfile } from '@trm/bots';
import { GameRegistry } from '../src/game/game-registry';
import { GameHub } from '../src/ws/hub';
import { GameNotLiveError, type ChatEntry, type GameStorePort } from '../src/persistence/types';
import {
  NOOP_REPORTER,
  SentryErrorReporter,
  type ErrorReporter,
  type ReportContext,
} from '../src/observability/error-reporter';

// The Sentry module is replaced wholesale: these tests assert what the reporter HANDS to the SDK
// (and that it survives the SDK being uninitialised), never that anything reaches the network.
const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock('@sentry/nestjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

/** Minimal stand-in for the Sentry scope the capture callbacks receive. */
interface FakeScope {
  tags: Record<string, string>;
  contexts: Record<string, unknown>;
  level: string | undefined;
  setTag(k: string, v: string): void;
  setContext(k: string, v: unknown): void;
  setLevel(l: string): void;
}

function fakeScope(): FakeScope {
  const scope = {
    tags: {} as Record<string, string>,
    contexts: {} as Record<string, unknown>,
    level: undefined as string | undefined,
    setTag(k: string, v: string) {
      scope.tags[k] = v;
    },
    setContext(k: string, v: unknown) {
      scope.contexts[k] = v;
    },
    setLevel(l: string) {
      scope.level = l;
    },
  };
  return scope;
}

beforeEach(() => {
  captureException.mockReset();
  captureMessage.mockReset();
});

describe('SentryErrorReporter', () => {
  it('tags the call site and scrubs the context it attaches', () => {
    new SentryErrorReporter().capture(new Error('boom'), 'ws.receive', {
      gameId: 'g1',
      // A caller that gets careless must not be able to widen the blast radius: the reporter
      // scrubs regardless of what the call site passes.
      token: 'super-secret',
    } as ReportContext);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, configure] = captureException.mock.calls[0] as [
      unknown,
      (s: ReturnType<typeof fakeScope>) => unknown,
    ];
    expect((error as Error).message).toBe('boom');

    const scope = fakeScope();
    configure(scope);
    expect(scope.tags['trm.site']).toBe('ws.receive');
    expect(scope.contexts.trm).toEqual({ gameId: 'g1', token: TELEMETRY_REDACTED });
  });

  it('defaults to error level and honours an explicit one', () => {
    const reporter = new SentryErrorReporter();
    reporter.captureMessage('plain', 'a');
    reporter.captureMessage('security', 'b', {}, 'fatal');

    const levels = (captureMessage.mock.calls as [string, (s: unknown) => unknown][]).map(
      ([, configure]) => {
        const scope = fakeScope();
        configure(scope);
        return scope.level;
      },
    );
    expect(levels).toEqual(['error', 'fatal']);
  });
});

describe('NOOP_REPORTER', () => {
  it('swallows everything (the default in tests and anywhere Sentry is not wired)', () => {
    expect(() => {
      NOOP_REPORTER.capture(new Error('x'), 'tag');
      NOOP_REPORTER.captureMessage('x', 'tag');
    }).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });
});

// ── Hub wiring ───────────────────────────────────────────────────────────────────────────────────

interface Report {
  kind: 'exception' | 'message';
  tag: string;
  context: ReportContext;
}

function recordingReporter(): { reports: Report[]; reporter: ErrorReporter } {
  const reports: Report[] = [];
  return {
    reports,
    reporter: {
      capture(_error, tag, context = {}) {
        reports.push({ kind: 'exception', tag, context });
      },
      captureMessage(_message, tag, context = {}) {
        reports.push({ kind: 'message', tag, context });
      },
    },
  };
}

/** Always rejects the write-ahead persist, so the bot driver exhausts its retries and stalls. */
class AlwaysFailingStore implements GameStorePort {
  async createGame(): Promise<void> {}
  async appendAction(_gameId: string): Promise<void> {
    throw new Error('injected persist failure');
  }
  async recordCompletion(): Promise<void> {}
  async getStatus(): Promise<undefined> {
    return undefined;
  }
  async addSpectator(): Promise<void> {}
  async loadForRecovery(): Promise<null> {
    return null;
  }
  async appendChat(): Promise<void> {}
  async loadChat(): Promise<ChatEntry[]> {
    return [];
  }
}

/** Rejects as TERMINATED — the terminal variant, which evicts rather than reschedules. */
class NotLiveStore extends AlwaysFailingStore {
  override async appendAction(gameId: string): Promise<void> {
    throw new GameNotLiveError(gameId, 'TERMINATED');
  }
}

function allBotConfig(gameId: string): { config: GameConfig; bots: BotProfile[] } {
  const seats: BotProfile[] = [
    { playerId: 'bot:1', difficulty: 'EASY' },
    { playerId: 'bot:2', difficulty: 'MEDIUM' },
  ];
  const players: PlayerSeed[] = seats.map((s, i) => ({
    id: asPlayerId(s.playerId),
    seat: i as SeatIndex,
  }));
  return { config: { seed: `report-${gameId}`, players, contentHash: CONTENT_HASH }, bots: seats };
}

async function waitUntil(pred: () => boolean, maxTicks = 50_000): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error('condition never became true');
}

describe('GameHub error reporting', () => {
  it('reports a bot-driver stall with the ids a maintainer needs, and nothing more', async () => {
    const { reports, reporter } = recordingReporter();
    const { config, bots } = allBotConfig('stalled');

    const hub = new GameHub(new GameRegistry(), {
      store: new AlwaysFailingStore(),
      reporter,
      botMoveDelayMs: 0,
      botPersistRetryDelayMs: 0,
      botDriverRescheduleMs: 5,
    });
    await hub.createMatch('stalled', taiwanBoard(), config, bots);

    await waitUntil(() => reports.length > 0);
    const report = reports[0];
    expect(report?.kind).toBe('message');
    expect(report?.tag).toBe('hub.bot_driver_stalled');
    expect(report?.context).toMatchObject({ reason: 'persist_failed', gameId: 'stalled' });
    // No game state rides along — only ids.
    expect(Object.keys(report?.context ?? {}).sort()).toEqual(['bot', 'gameId', 'reason']);
  });

  it('stays silent on the terminal not-LIVE path, which is a cleanup and not a bug', async () => {
    const { reports, reporter } = recordingReporter();
    const { config, bots } = allBotConfig('not-live');
    const registry = new GameRegistry();

    const hub = new GameHub(registry, {
      store: new NotLiveStore(),
      reporter,
      botMoveDelayMs: 0,
      botPersistRetryDelayMs: 0,
      botDriverRescheduleMs: 5,
    });
    await hub.createMatch('not-live', taiwanBoard(), config, bots);

    await waitUntil(() => registry.get('not-live') === undefined);
    expect(reports).toEqual([]);
  });

  it('defaults to the no-op reporter when none is supplied', async () => {
    const { config, bots } = allBotConfig('default');
    const hub = new GameHub(new GameRegistry(), {
      store: new AlwaysFailingStore(),
      botMoveDelayMs: 0,
      botPersistRetryDelayMs: 0,
      botDriverRescheduleMs: 5,
    });
    await expect(hub.createMatch('default', taiwanBoard(), config, bots)).resolves.toBeDefined();
  });
});
