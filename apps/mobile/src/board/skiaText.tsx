// Centred Skia text using the system font collection, so zh-Hant glyphs shape correctly
// (PingFang on iOS / Noto Sans TC on Android) — the native equivalent of the web board's
// `.city-label` / `.glyph-badge text`. Building a paragraph is fully guarded: if the Paragraph API
// is unavailable (the jest mock) or its surface differs on a given Skia build, it renders nothing
// rather than crashing. Labels/glyphs are a progressive enhancement layered over the always-visible
// markers and routes, never a correctness dependency.
import { useMemo } from 'react';
import { Paragraph, Skia, TextAlign, type SkParagraph } from '@shopify/react-native-skia';

function buildParagraph(
  text: string,
  fontSize: number,
  color: string,
  maxWidth: number,
): SkParagraph | null {
  try {
    // No custom font provider → the paragraph builder resolves against the platform's SYSTEM font
    // collection, which is what carries the CJK faces (PingFang on iOS, Noto Sans TC on Android).
    const make = Skia.ParagraphBuilder?.Make;
    if (!make) return null;
    const para = make({ textAlign: TextAlign.Center })
      .pushStyle({ color: Skia.Color(color), fontSize })
      .addText(text)
      .build();
    para.layout(maxWidth);
    return para;
  } catch {
    return null;
  }
}

export interface BoardTextProps {
  text: string;
  /** Anchor (board units) — text is horizontally centred on `x`, its box top at `y`. */
  x: number;
  y: number;
  /** Font size in board units (already multiplied by the label counter-scale by the caller). */
  size: number;
  color: string;
  /** Paragraph box width in board units (centring reference). Defaults to a generous 40. */
  maxWidth?: number;
}

export function BoardText({ text, x, y, size, color, maxWidth = 40 }: BoardTextProps) {
  const para = useMemo(
    () => buildParagraph(text, size, color, maxWidth),
    [text, size, color, maxWidth],
  );
  if (!para) return null;
  return <Paragraph paragraph={para} x={x - maxWidth / 2} y={y} width={maxWidth} />;
}
