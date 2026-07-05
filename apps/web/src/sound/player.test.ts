import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSoundPlayer } from './player';

function mockContext() {
  const starts: ReturnType<typeof vi.fn>[] = [];
  const ctx = {
    state: 'suspended' as AudioContextState,
    destination: {},
    resume: vi.fn(function (this: { state: string }) {
      this.state = 'running';
      return Promise.resolve();
    }),
    createGain: () => ({ gain: { value: 0 }, connect: (n: unknown) => n }),
    createBufferSource: () => {
      const start = vi.fn();
      starts.push(start);
      return { buffer: null as unknown, connect: (n: unknown) => n, start };
    },
    decodeAudioData: () => Promise.resolve({ duration: 1 } as unknown as AudioBuffer),
  };
  return { ctx, starts };
}

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
    p.play('cardDraw'); // t=0 → plays
    t = 10;
    p.play('cardDraw'); // within 55ms throttle → dropped
    t = 100;
    p.play('cardDraw'); // → plays
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
});
