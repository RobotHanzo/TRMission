import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTapArbiter, DOUBLE_TAP_MS, DOUBLE_TAP_SLOP_PX } from './tapArbiter';
import type { CameraState } from './camera';

const CAM_A: CameraState = { cx: 10, cy: 20, span: 40 };
const CAM_B: CameraState = { cx: 11, cy: 21, span: 30 };

describe('tapArbiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => {
    const onSingle = vi.fn();
    const onDouble = vi.fn();
    const arbiter = createTapArbiter({ onSingle, onDouble });
    return { arbiter, onSingle, onDouble };
  };

  it('dispatches a lone tap once, after the double-tap window, with its tap-time camera', () => {
    const { arbiter, onSingle, onDouble } = make();
    arbiter.tap(100, 200, CAM_A);
    expect(onSingle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onSingle).toHaveBeenCalledWith({ x: 100, y: 200 }, CAM_A);
    vi.advanceTimersByTime(1000);
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onDouble).not.toHaveBeenCalled();
  });

  it('turns two quick nearby taps into one double, never a single', () => {
    const { arbiter, onSingle, onDouble } = make();
    arbiter.tap(100, 200, CAM_A);
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 50);
    arbiter.tap(110, 205, CAM_A);
    expect(onDouble).toHaveBeenCalledTimes(1);
    expect(onDouble).toHaveBeenCalledWith(110, 205);
    vi.advanceTimersByTime(1000);
    expect(onSingle).not.toHaveBeenCalled();
  });

  it('treats a far-apart second tap as two singles (first flushes immediately)', () => {
    const { arbiter, onSingle, onDouble } = make();
    arbiter.tap(100, 200, CAM_A);
    vi.advanceTimersByTime(100);
    arbiter.tap(100 + DOUBLE_TAP_SLOP_PX + 1, 200, CAM_B);
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onSingle).toHaveBeenCalledWith({ x: 100, y: 200 }, CAM_A);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(onSingle).toHaveBeenCalledTimes(2);
    expect(onSingle).toHaveBeenLastCalledWith(
      { x: 100 + DOUBLE_TAP_SLOP_PX + 1, y: 200 },
      CAM_B,
    );
    expect(onDouble).not.toHaveBeenCalled();
  });

  it('treats a nearby-but-late second tap as two singles (timer-starved dispatch)', () => {
    // A blocked JS thread can delay the pending timer past the window; the wall clock, not the
    // timer's fate, decides whether the pair was a double.
    const { arbiter, onSingle, onDouble } = make();
    arbiter.tap(100, 200, CAM_A);
    // Simulate starvation: advance the clock WITHOUT running the timer callback.
    vi.setSystemTime(DOUBLE_TAP_MS + 200);
    arbiter.tap(102, 201, CAM_B);
    expect(onDouble).not.toHaveBeenCalled();
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onSingle).toHaveBeenCalledWith({ x: 100, y: 200 }, CAM_A);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(onSingle).toHaveBeenCalledTimes(2);
  });

  it('a third tap after a double starts a fresh single', () => {
    const { arbiter, onSingle, onDouble } = make();
    arbiter.tap(100, 200, CAM_A);
    arbiter.tap(100, 200, CAM_A);
    expect(onDouble).toHaveBeenCalledTimes(1);
    arbiter.tap(300, 300, CAM_B);
    vi.advanceTimersByTime(DOUBLE_TAP_MS);
    expect(onSingle).toHaveBeenCalledTimes(1);
    expect(onSingle).toHaveBeenCalledWith({ x: 300, y: 300 }, CAM_B);
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it('dispose drops a pending single', () => {
    const { arbiter, onSingle } = make();
    arbiter.tap(100, 200, CAM_A);
    arbiter.dispose();
    vi.advanceTimersByTime(1000);
    expect(onSingle).not.toHaveBeenCalled();
  });
});
