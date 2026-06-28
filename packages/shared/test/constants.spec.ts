import { describe, it, expect } from 'vitest';
import { DEFAULT_RULE_PARAMS } from '../src/constants';

describe('RuleParams rule variants', () => {
  it('defaults all three variant flags to false', () => {
    expect(DEFAULT_RULE_PARAMS.unlimitedStationBorrow).toBe(false);
    expect(DEFAULT_RULE_PARAMS.secondDrawAfterBlindRainbow).toBe(false);
    expect(DEFAULT_RULE_PARAMS.noUnfinishedTicketPenalty).toBe(false);
  });
});
