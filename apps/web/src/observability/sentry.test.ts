import { describe, expect, it } from 'vitest';
import { isStacklessWebkitNoise } from './sentry';

const webkitValue = 'The string did not match the expected pattern.';

describe('isStacklessWebkitNoise', () => {
  it('drops the stackless WebKit DOMException (TRMISSION-WEB-4)', () => {
    expect(
      isStacklessWebkitNoise({
        exception: { values: [{ type: 'SyntaxError', value: webkitValue }] },
      }),
    ).toBe(true);
  });

  it('keeps the same message when it carries frames we could act on', () => {
    expect(
      isStacklessWebkitNoise({
        exception: {
          values: [
            {
              type: 'SyntaxError',
              value: webkitValue,
              stacktrace: { frames: [{ filename: '/assets/index.js' }] },
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it('keeps every other stackless error', () => {
    expect(
      isStacklessWebkitNoise({
        exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] },
      }),
    ).toBe(false);
    expect(isStacklessWebkitNoise({})).toBe(false);
  });
});
