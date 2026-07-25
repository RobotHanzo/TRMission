import { describe, expect, it } from 'vitest';
import { LEGAL_PATHS, splitLegalNotice } from '../src/legal';
import { auth as en } from '../src/i18n/locales/en';
import { auth as zhHant } from '../src/i18n/locales/zh-Hant';

const labels = { terms: 'Terms', privacy: 'Privacy' };

describe('splitLegalNotice', () => {
  it('splits a notice into text and the two link runs, in order', () => {
    expect(splitLegalNotice('Read the {terms} and {privacy}.', labels)).toEqual([
      { text: 'Read the ' },
      { text: 'Terms', doc: 'terms' },
      { text: ' and ' },
      { text: 'Privacy', doc: 'privacy' },
      { text: '.' },
    ]);
  });

  it('handles a notice that starts or ends on a link (zh has no trailing space)', () => {
    expect(splitLegalNotice('{privacy}', labels)).toEqual([{ text: 'Privacy', doc: 'privacy' }]);
  });

  it('leaves a notice without tokens as a single text run', () => {
    expect(splitLegalNotice('No links here', labels)).toEqual([{ text: 'No links here' }]);
  });

  // Both clients render the shipped string — a typo'd token would silently drop a required link.
  it.each([
    ['en', en.legalNotice],
    ['zh-Hant', zhHant.legalNotice],
  ])('the %s notice links both documents', (_locale, notice) => {
    const docs = splitLegalNotice(notice, labels)
      .map((s) => s.doc)
      .filter(Boolean);
    expect(docs).toEqual(['terms', 'privacy']);
  });

  it('pins the public paths both clients link to', () => {
    expect(LEGAL_PATHS).toEqual({ terms: '/terms', privacy: '/privacy' });
  });
});
