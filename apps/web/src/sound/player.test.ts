import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSoundPlayer } from './player';

interface MockSource {
  buffer: unknown;
  connect: (n: unknown) => unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

function mockContext() {
  const starts: ReturnType<typeof vi.fn>[] = [];
  const sources: MockSource[] = [];
  const ctx = {
    state: 'suspended' as AudioContextState,
    currentTime: 0,
    destination: {},
    resume: vi.fn(function (this: { state: string }) {
      this.state = 'running';
      return Promise.resolve();
    }),
    createGain: () => ({ gain: { value: 0 }, connect: (n: unknown) => n }),
    createBufferSource: () => {
      const src: MockSource = {
        buffer: null,
        connect: (n: unknown) => n,
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
      };
      starts.push(src.start);
      sources.push(src);
      return src;
    },
    decodeAudioData: () => Promise.resolve({ duration: 1 } as unknown as AudioBuffer),
  };
  return { ctx, starts, sources };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  global.fetch = vi
    .fn()
    .mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) as typeof fetch;
});

describe('sound player', () => {
  it('no-ops when no AudioContext is available', async () => {
    const p = createSoundPlayer({ createContext: () => null });
    await p.preload();
    expect(() => p.play('cardDraw')).not.toThrow();
  });

  it('plays a preloaded cue once and throttles a rapid repeat', async () => {
    const { ctx, starts } = mockContext();
    let t = 0;
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => t,
    });
    await p.preload();
    p.play('cardDraw'); // t=0, suspended → kicks off resume (mock flips to running), deferred
    t = 10;
    p.play('cardDraw'); // context running now → plays
    t = 100;
    p.play('cardDraw'); // 90ms after the last play (≥ 55ms throttle) → plays
    await flush(); // the deferred t=0 play lands inside the t=100 throttle window → dropped
    expect(starts.filter((s) => s.mock.calls.length > 0).length).toBe(2);
  });

  it('does not play when disabled', async () => {
    const { ctx, starts } = mockContext();
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    p.setEnabled(false);
    p.play('cardDraw');
    expect(starts.every((s) => s.mock.calls.length === 0)).toBe(true);
  });

  it('unlock resumes a suspended context', () => {
    const { ctx } = mockContext();
    const p = createSoundPlayer({ createContext: () => ctx as unknown as AudioContext });
    p.unlock();
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('never queues a source on a suspended context; plays once a prompt resume lands', async () => {
    const { ctx, starts } = mockContext();
    let resolveResume!: () => void;
    ctx.resume = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveResume = () => {
            ctx.state = 'running';
            res();
          };
        }),
    ) as typeof ctx.resume;
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    p.play('cardDraw');
    expect(starts.every((s) => s.mock.calls.length === 0)).toBe(true); // nothing queued
    resolveResume();
    await flush();
    expect(starts.filter((s) => s.mock.calls.length > 0).length).toBe(1);
  });

  it('drops a suspended-context cue whose resume arrives after the grace window', async () => {
    const { ctx, starts } = mockContext();
    let resolveResume!: () => void;
    ctx.resume = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveResume = () => {
            ctx.state = 'running';
            res();
          };
        }),
    ) as typeof ctx.resume;
    let t = 0;
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => t,
    });
    await p.preload();
    p.play('yourTurn');
    t = 60_000; // the unlocking click comes a minute later — the moment has passed
    resolveResume();
    await flush();
    expect(starts.every((s) => s.mock.calls.length === 0)).toBe(true);
    // ...and the dropped cue did not charge the throttle window: a fresh play sounds.
    p.play('yourTurn');
    await flush();
    expect(starts.filter((s) => s.mock.calls.length > 0).length).toBe(1);
  });

  it('survives a rejected resume (no user activation yet)', async () => {
    const { ctx, starts } = mockContext();
    ctx.resume = vi.fn(() => Promise.reject(new Error('blocked'))) as typeof ctx.resume;
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    expect(() => p.play('cardDraw')).not.toThrow();
    await flush();
    expect(starts.every((s) => s.mock.calls.length === 0)).toBe(true);
  });

  it('schedule() starts the source at the audio-clock offset and cancel stops it', async () => {
    const { ctx, sources } = mockContext();
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    ctx.state = 'running';
    ctx.currentTime = 2;
    const cancel = p.schedule('countdownLapsed', 3_000);
    const src = sources.at(-1)!;
    expect(src.start).toHaveBeenCalledWith(5); // 2s now + 3s ahead
    cancel();
    expect(src.stop).toHaveBeenCalled();
    expect(src.disconnect).toHaveBeenCalled();
  });

  it('schedule() is a no-op on a context that is not running', async () => {
    const { ctx, sources } = mockContext();
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    const cancel = p.schedule('countdownWarning', 1_000);
    expect(sources.length).toBe(0);
    expect(() => cancel()).not.toThrow();
  });

  it('setEnabled(false) cancels every pending scheduled cue', async () => {
    const { ctx, sources } = mockContext();
    const p = createSoundPlayer({
      createContext: () => ctx as unknown as AudioContext,
      now: () => 0,
    });
    await p.preload();
    ctx.state = 'running';
    p.schedule('countdownWarning', 1_000);
    p.schedule('countdownLapsed', 2_000);
    p.setEnabled(false);
    expect(sources.length).toBe(2);
    expect(sources.every((s) => s.stop.mock.calls.length > 0)).toBe(true);
  });
});
