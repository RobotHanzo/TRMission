import { describe, expect, it } from 'vitest';
import { DENY_URLS, IGNORED_ERRORS, isStacklessWebkitNoise } from './sentry';

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

// `ignoreErrors` matches strings by substring and regexes by test, against the event message and
// `type: value`; `denyUrls` runs the same way over the frame filename. Mirrored here so a typo in
// one of the patterns fails the suite instead of quietly reopening the issue it closed.
const matches = (patterns: (string | RegExp)[], candidate: string): boolean =>
  patterns.some((p) => (typeof p === 'string' ? candidate.includes(p) : p.test(candidate)));

describe('in-app browser noise filters', () => {
  it('drops the Android WebView bridge teardown (TRMISSION-WEB-9)', () => {
    expect(matches(IGNORED_ERRORS, 'Error: Error invoking postMessage: Java object is gone')).toBe(
      true,
    );
    expect(matches(DENY_URLS, 'iabjs://navigation_performance_logger_android')).toBe(true);
  });

  it('drops the iOS WKWebView bridge teardown (TRMISSION-WEB-1)', () => {
    expect(
      matches(
        IGNORED_ERRORS,
        "undefined is not an object (evaluating 'window.webkit.messageHandlers')",
      ),
    ).toBe(true);
  });

  it('keeps errors thrown from our own bundle', () => {
    expect(
      matches(IGNORED_ERRORS, "TypeError: Cannot read properties of undefined (reading 'hand')"),
    ).toBe(false);
    expect(matches(DENY_URLS, 'https://trmission.robothanzo.dev/assets/index-a1b2c3.js')).toBe(
      false,
    );
  });
});
