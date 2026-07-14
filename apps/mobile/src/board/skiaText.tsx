// Centred Skia text using the system font collection, so zh-Hant glyphs shape correctly
// (PingFang on iOS / Noto Sans TC on Android) — the native equivalent of the web board's
// `.city-label` / `.glyph-badge text`. Building a paragraph is fully guarded: if the Paragraph API
// is unavailable (the jest mock) or its surface differs on a given Skia build, it renders nothing
// rather than crashing. Labels/glyphs are a progressive enhancement layered over the always-visible
// markers and routes, never a correctness dependency.
import { useMemo } from 'react';
import {
  Paragraph,
  Skia,
  TextAlign,
  PaintStyle,
  StrokeJoin,
  type FontWeight,
  type SkParagraph,
  type SkPaint,
} from '@shopify/react-native-skia';

/** A stroke paint for the label halo — mirrors the web `.city-label` `paint-order: stroke` outline
 *  (`stroke-linejoin: round`). Guarded: an environment without the Paint API (the jest mock) yields
 *  no halo and the fill text still renders. */
function haloPaint(color: string, width: number): SkPaint | undefined {
  try {
    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(width);
    paint.setStrokeJoin(StrokeJoin.Round); // no spikes where CJK strokes meet, like the web outline
    paint.setColor(Skia.Color(color));
    paint.setAntiAlias(true);
    return paint;
  } catch {
    return undefined;
  }
}

function buildParagraph(
  text: string,
  fontSize: number,
  color: string,
  maxWidth: number,
  weight: FontWeight | undefined,
  foreground: SkPaint | undefined,
): SkParagraph | null {
  try {
    // No custom font provider → the paragraph builder resolves against the platform's SYSTEM font
    // collection, which is what carries the CJK faces (PingFang on iOS, Noto Sans TC on Android).
    const make = Skia.ParagraphBuilder?.Make;
    if (!make) return null;
    const style = {
      color: Skia.Color(color),
      fontSize,
      ...(weight !== undefined ? { fontStyle: { weight } } : {}),
    };
    // A foreground paint (when present) overrides the fill colour — used to paint the stroke halo.
    const para = make({ textAlign: TextAlign.Center })
      .pushStyle(style, foreground)
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
  /** Anchor (board units) — text is horizontally centred on `x`. `y` is the box top, or its
   *  bottom when `anchorBottom` is set. */
  x: number;
  y: number;
  /** Font size in board units (already multiplied by the label counter-scale by the caller). */
  size: number;
  color: string;
  /** Paragraph box width in board units (centring reference). Defaults to a generous 40. */
  maxWidth?: number;
  /** Font weight — web `.city-label` is 700 (bold). */
  weight?: FontWeight;
  /** A stroke halo drawn behind the fill, mirroring the web label's `paint-order: stroke` outline
   *  (colour = the land tint, or the sea tint for island labels). */
  halo?: { color: string; width: number };
  /** Interpret `y` as the BOTTOM of the text box — places the label above its anchor (web labels
   *  sit just above the city marker) instead of below it. */
  anchorBottom?: boolean;
}

export function BoardText({
  text,
  x,
  y,
  size,
  color,
  maxWidth = 40,
  weight,
  halo,
  anchorBottom = false,
}: BoardTextProps) {
  // Keyed on the halo's primitive values (not the object identity the caller re-creates each render)
  // so the native paint isn't rebuilt every frame.
  const foreground = useMemo(
    () => (halo ? haloPaint(halo.color, halo.width) : undefined),
    [halo?.color, halo?.width],
  );
  const fill = useMemo(
    () => buildParagraph(text, size, color, maxWidth, weight, undefined),
    [text, size, color, maxWidth, weight],
  );
  const stroke = useMemo(
    () => (foreground ? buildParagraph(text, size, color, maxWidth, weight, foreground) : null),
    [text, size, color, maxWidth, weight, foreground],
  );
  if (!fill) return null;
  const top = anchorBottom ? y - (fill.getHeight?.() ?? size * 1.3) : y;
  const left = x - maxWidth / 2;
  return (
    <>
      {stroke && <Paragraph paragraph={stroke} x={left} y={top} width={maxWidth} />}
      <Paragraph paragraph={fill} x={left} y={top} width={maxWidth} />
    </>
  );
}
