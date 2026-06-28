import { describe, it, expect, beforeEach } from 'vitest';
import { useAnimations } from './animations';
import type { AnimIntent } from '../game/animationModel';

const push = (i: AnimIntent) => useAnimations.getState().pushIntent(i);
const ticket = (over: Partial<Extract<AnimIntent, { kind: 'ticketComplete' }>>): AnimIntent => ({
  kind: 'ticketComplete',
  playerId: 'p0',
  ticketId: 't1',
  isYou: true,
  long: false,
  seat: 0,
  path: ['R1'],
  ...over,
});

describe('animations store', () => {
  beforeEach(() => useAnimations.getState().reset());

  it('routes glow/station/float/flight intents into their slices', () => {
    push({ kind: 'glowRoute', routeId: 'R1', seat: 2 });
    push({ kind: 'glowStation', cityId: 'C1', seat: 3 });
    push({ kind: 'scoreFloat', playerId: 'p1', amount: 5 });
    push({ kind: 'cardFly', toPlayerId: 'p0', faceUp: true, color: 'RED', slot: 1 });
    const s = useAnimations.getState();
    expect(s.glowingRoutes.get('R1')).toBe(2);
    expect(s.glowingStations.get('C1')).toBe(3);
    expect(s.floats).toHaveLength(1);
    expect(s.flights).toHaveLength(1);
  });

  it('own completion opens a fanfare and a board sweep', () => {
    push(ticket({ isYou: true }));
    const s = useAnimations.getState();
    expect(s.fanfare).not.toBeNull();
    expect(s.sweeps).toHaveLength(1);
    expect(s.ticketCues).toHaveLength(0);
  });

  it('a second own completion queues; dismissFanfare advances then clears', () => {
    push(ticket({ ticketId: 't1' }));
    push(ticket({ ticketId: 't2' }));
    expect(useAnimations.getState().fanfare?.ticketId).toBe('t1');
    useAnimations.getState().dismissFanfare();
    expect(useAnimations.getState().fanfare?.ticketId).toBe('t2');
    useAnimations.getState().dismissFanfare();
    expect(useAnimations.getState().fanfare).toBeNull();
  });

  it('marketCover holds a slot face-down; revealMarketSlots flips it into view', () => {
    push({ kind: 'marketCover', slot: 2 });
    expect(useAnimations.getState().coveredMarketSlots.has(2)).toBe(true);
    expect(useAnimations.getState().marketFlips.has(2)).toBe(false);
    useAnimations.getState().revealMarketSlots();
    const s = useAnimations.getState();
    expect(s.coveredMarketSlots.size).toBe(0);
    expect(s.marketFlips.has(2)).toBe(true);
  });

  it('opponent completion shows a subtle cue + sweep, no fanfare', () => {
    push(ticket({ isYou: false, playerId: 'p1', seat: 1 }));
    const s = useAnimations.getState();
    expect(s.fanfare).toBeNull();
    expect(s.ticketCues).toHaveLength(1);
    expect(s.sweeps).toHaveLength(1);
  });

  it('reset clears everything', () => {
    push({ kind: 'glowRoute', routeId: 'R1', seat: 1 });
    push({ kind: 'marketCover', slot: 0 });
    push(ticket({}));
    useAnimations.getState().reset();
    const s = useAnimations.getState();
    expect(s.glowingRoutes.size).toBe(0);
    expect(s.coveredMarketSlots.size).toBe(0);
    expect(s.fanfare).toBeNull();
    expect(s.sweeps).toHaveLength(0);
  });
});
