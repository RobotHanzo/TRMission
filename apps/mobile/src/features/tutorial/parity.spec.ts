import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The curriculum is SHARED CONTENT: the anchor-id strings inside it are the web's CSS selectors
// and the mobile registry's anchor ids at once. Any drift pins a permanent maintenance tax, so
// the ported core must stay byte-identical (modulo line endings) to apps/web. A legitimate
// change lands in apps/web first, then re-copies here.
const here = dirname(fileURLToPath(import.meta.url));
const webTutorial = join(here, '..', '..', '..', '..', 'web', 'src', 'features', 'tutorial');
const norm = (s: string): string => s.replace(/\r\n/g, '\n').trimEnd();
const read = (p: string): string => norm(readFileSync(p, 'utf8'));

describe('tutorial core is byte-identical to apps/web', () => {
  for (const f of ['types.ts', 'curriculum.ts', 'focus.ts'] as const) {
    it(`features/tutorial/${f}`, () => {
      expect(read(join(here, f))).toBe(read(join(webTutorial, f)));
    });
  }
  it('i18n/tutorial.ts', () => {
    expect(read(join(here, '..', '..', 'i18n', 'tutorial.ts'))).toBe(
      read(join(webTutorial, '..', '..', 'i18n', 'tutorial.ts')),
    );
  });
});
