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
        require('./shims');
      });
      expect(typeof Intl.PluralRules).toBe('function');
      expect(new Intl.PluralRules('en').select(1)).toBe('one');
      expect(new Intl.PluralRules('en').select(2)).toBe('other');
    } finally {
      (Intl as { PluralRules?: unknown }).PluralRules = saved;
    }
  });
});
