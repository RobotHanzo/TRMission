import { describe, it, expect } from 'vitest';
import { evaluateTickets } from '../src/graph/connectivity';

describe('noUnfinishedTicketPenalty', () => {
  const baseArgs = {
    ownEdges: [] as { a: string; b: string }[],
    stationCities: [] as string[],
    borrowCandidates: new Map<string, { a: string; b: string }[]>(),
    tickets: [{ a: 'X', b: 'Y', value: 10 }],
    vertices: ['X', 'Y'],
  };

  it('penalises an unfinished ticket by default', () => {
    const res = evaluateTickets(baseArgs);
    expect(res.net).toBe(-10);
    expect(res.completed).toBe(0);
  });

  it('scores an unfinished ticket 0 when the penalty is disabled', () => {
    const res = evaluateTickets({ ...baseArgs, noUnfinishedTicketPenalty: true });
    expect(res.net).toBe(0);
    expect(res.completed).toBe(0);
  });

  it('still adds value for a completed ticket regardless of the flag', () => {
    const args = { ...baseArgs, ownEdges: [{ a: 'X', b: 'Y' }] };
    expect(evaluateTickets(args).net).toBe(10);
    expect(evaluateTickets({ ...args, noUnfinishedTicketPenalty: true }).net).toBe(10);
  });
});
