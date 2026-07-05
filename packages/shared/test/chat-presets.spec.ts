import { describe, it, expect } from 'vitest';
import { CHAT_PRESET_IDS, isChatPresetId } from '../src/chat-presets';

describe('chat presets', () => {
  it('has exactly the 12 curated ids, in order', () => {
    expect(CHAT_PRESET_IDS).toEqual([
      'GREETING',
      'GOOD_LUCK',
      'THANKS',
      'SORRY',
      'ONE_MOMENT',
      'NICE_MOVE',
      'WELL_PLAYED',
      'GOOD_GAME',
      'LETS_GO',
      'STILL_THERE',
      'YES',
      'NO',
    ]);
  });

  it('isChatPresetId accepts every catalog id and rejects anything else', () => {
    for (const id of CHAT_PRESET_IDS) expect(isChatPresetId(id)).toBe(true);
    expect(isChatPresetId('NOT_A_PRESET')).toBe(false);
    expect(isChatPresetId('')).toBe(false);
  });
});
