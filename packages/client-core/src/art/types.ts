import type { CardColor } from '@trm/shared';

/**
 * One card's artwork in ONE skin pack. Every pack — generated from an illustration sheet or
 * written by hand — produces this exact shape, which is what lets a single renderer per platform
 * serve all of them (`dangerouslySetInnerHTML` on web, `SvgXml` on native).
 *
 * Two properties are load-bearing and apply to every pack, not just the generated one:
 *
 * - **No CSS.** react-native-svg applies no stylesheet, so a `<style>` block or a `class=`
 *   reaching a body means blank cards on mobile.
 * - **No literal colours.** Every ink is a `$n` placeholder into `palette`, so a night livery is
 *   a palette swap in plain TS rather than a media query. A pack that looks the same in both
 *   themes sets `paletteDark` to the same values (it must stay the same length and order).
 *   Opacity is NOT a colour: `fill="$3" fill-opacity="0.16"` is the way to draw a wash.
 */
export interface TrainCarArtwork {
  /** Vehicle name as drawn. */
  readonly name: string;
  /** Class/series line beneath it. */
  readonly model: string;
  readonly viewBox: string;
  /** SVG body with `$n` ink placeholders — never render this without resolving it. */
  readonly body: string;
  readonly palette: readonly string[];
  /** The night livery: same length and order as `palette`. */
  readonly paletteDark: readonly string[];
}

/** A whole skin pack: one artwork per card colour. */
export type TrainCarArtSet = Record<CardColor, TrainCarArtwork>;
