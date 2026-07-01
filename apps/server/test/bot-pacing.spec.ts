import { describe, it, expect } from 'vitest';
import { botStepDelayMs } from '../src/ws/bot-pacing';

describe('botStepDelayMs', () => {
  it('leaves ordinary bot moves at the configured pacing delay', () => {
    expect(botStepDelayMs('AWAIT_ACTION', 0, 600)).toBe(600);
    expect(botStepDelayMs('DRAWING_CARDS', 0, 600)).toBe(600);
    expect(botStepDelayMs('TICKET_SELECTION', 0, 600)).toBe(600);
  });

  it('holds a tunnel resolution until the reveal animation finishes, plus a 1s read buffer', () => {
    // 3 revealed cards, mirroring TunnelModal.tsx: (3-1)*500 + 600 + 120 = 1720, +1000 = 2720.
    expect(botStepDelayMs('TUNNEL_PENDING', 3, 600)).toBe(2720);
  });

  it('scales with however many cards were actually revealed', () => {
    // A single revealed card (deck ran low): (1-1)*500 + 600 + 120 = 720, +1000 = 1720.
    expect(botStepDelayMs('TUNNEL_PENDING', 1, 600)).toBe(1720);
    // No cards revealed at all: 0 + 600 + 120 = 720, +1000 = 1720 (same floor as one card).
    expect(botStepDelayMs('TUNNEL_PENDING', 0, 600)).toBe(1720);
  });

  it('never returns less than the configured pacing delay, even for an unusually long one', () => {
    expect(botStepDelayMs('TUNNEL_PENDING', 3, 5000)).toBe(5000);
  });

  it('stays disabled when pacing is off (test mode)', () => {
    expect(botStepDelayMs('AWAIT_ACTION', 0, 0)).toBe(0);
    expect(botStepDelayMs('TUNNEL_PENDING', 3, 0)).toBe(0);
  });
});
