// The two public legal documents. Both are pages of the web app (mobile opens them on the
// configured server origin), so the paths live here rather than in either client.
export const LEGAL_PATHS = { terms: '/terms', privacy: '/privacy' } as const;

export type LegalDoc = keyof typeof LEGAL_PATHS;

/** One run of the sign-in notice: plain text, or the label of a document to link. */
export interface LegalNoticeSegment {
  text: string;
  doc?: LegalDoc;
}

// Single braces, NOT i18next's `{{…}}`: the notice is one translated sentence whose two document
// names must render as links, and i18next interpolation can only produce a flat string.
const TOKEN = /\{(terms|privacy)\}/g;

/** Splits the translated notice (`auth.legalNotice`) into text + link runs, so web and mobile
 *  render the same sentence — with the same link positions — from one source string. */
export function splitLegalNotice(
  template: string,
  labels: Record<LegalDoc, string>,
): LegalNoticeSegment[] {
  const segments: LegalNoticeSegment[] = [];
  let cut = 0;
  for (const match of template.matchAll(TOKEN)) {
    const doc = match[1] as LegalDoc;
    if (match.index > cut) segments.push({ text: template.slice(cut, match.index) });
    segments.push({ text: labels[doc], doc });
    cut = match.index + match[0].length;
  }
  if (cut < template.length) segments.push({ text: template.slice(cut) });
  return segments;
}
