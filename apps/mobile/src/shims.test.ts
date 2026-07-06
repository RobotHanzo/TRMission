/**
 * Verifies the Hermes runtime shims install the globals protobuf-es and i18next depend on.
 *
 * The jest runtime (Node) already provides `TextDecoder` and `Intl.PluralRules`, so a bare
 * `import './shims'` would pass trivially and never exercise the shim. Instead each test *removes*
 * the global to simulate Hermes (which ships TextEncoder but not a spec TextDecoder, and an
 * incomplete Intl), reloads `./shims` in an isolated module registry, and asserts the shim
 * reinstated a working implementation — the placeholder/no-op shim leaves the global missing (red).
 */
describe('runtime shims (simulating Hermes)', () => {
  it('installs a UTF-8 TextDecoder when the runtime lacks one (protobuf-es needs it)', () => {
    const saved = globalThis.TextDecoder;
    try {
      // @ts-expect-error simulate Hermes: no spec TextDecoder
      delete globalThis.TextDecoder;
      jest.isolateModules(() => {
        // isolateModules needs a non-hoisted require so ./shims re-runs against the deleted globals.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./shims');
      });
      expect(typeof globalThis.TextDecoder).toBe('function');
      const bytes = new TextEncoder().encode('台鐵任務');
      expect(new globalThis.TextDecoder('utf-8').decode(bytes)).toBe('台鐵任務');
    } finally {
      globalThis.TextDecoder = saved;
    }
  });

  it('installs Intl.PluralRules when the runtime lacks one (i18next zh/en plurals)', () => {
    const saved = Intl.PluralRules;
    try {
      // simulate Hermes: incomplete Intl (the cast makes PluralRules deletable)
      delete (Intl as { PluralRules?: unknown }).PluralRules;
      jest.isolateModules(() => {
        // isolateModules needs a non-hoisted require so ./shims re-runs against the deleted globals.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./shims');
      });
      expect(typeof Intl.PluralRules).toBe('function');
      expect(new Intl.PluralRules('en').select(1)).toBe('one');
      expect(new Intl.PluralRules('en').select(2)).toBe('other');
    } finally {
      (Intl as { PluralRules?: unknown }).PluralRules = saved;
    }
  });

  it('installs Intl.Locale before the pluralrules polyfill loads (Hermes ships no Intl.Locale)', () => {
    // Regression for the boot crash caught on the first physical Android run: intl-pluralrules'
    // shouldPolyfill routes through @formatjs/intl-localematcher's best-fit matcher, which does
    // `new Intl.Locale(…)`. Hermes has no Intl.Locale, so loading the pluralrules polyfill before an
    // Intl.Locale polyfill throws "… is not a constructor" at boot, before any screen renders. The
    // PluralRules test above can't catch this because Node keeps its native Intl.Locale — only
    // deleting BOTH reproduces the device, and the shim must polyfill Locale FIRST.
    const savedPluralRules = Intl.PluralRules;
    const savedLocale = (Intl as { Locale?: unknown }).Locale;
    try {
      delete (Intl as { PluralRules?: unknown }).PluralRules;
      delete (Intl as { Locale?: unknown }).Locale;
      expect(() =>
        jest.isolateModules(() => {
          // isolateModules needs a non-hoisted require so ./shims re-runs against the deleted globals.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./shims');
        }),
      ).not.toThrow();
      expect(typeof (Intl as { Locale?: unknown }).Locale).toBe('function');
      expect(typeof Intl.PluralRules).toBe('function');
      expect(new Intl.PluralRules('en').select(1)).toBe('one');
      expect(new Intl.PluralRules('zh').select(1)).toBe('other');
    } finally {
      (Intl as { PluralRules?: unknown }).PluralRules = savedPluralRules;
      (Intl as { Locale?: unknown }).Locale = savedLocale;
    }
  });
});
