// The train-card artwork registry: one entry per skin pack, and the resolver both clients render
// through. Packs live in ./skins — `rollingStock` is generated from the authored sheets
// (tools/trainCarArt.mjs), `classic` is the hand-drawn original kept as a skin. Every pack is the
// same `TrainCarArtSet` shape (see ./types for the two rules that make that possible), so adding
// one never touches a renderer.
//
// Which packs a player may actually choose is a SERVER question (a maintainer can switch a pack
// off from the dashboard) — resolve a preference with `../game/trainCarSkins`, then pass the
// answer here.
import { DEFAULT_TRAIN_CAR_SKIN, type CardColor, type TrainCarSkin } from '@trm/shared';
import type { TrainCarArtSet, TrainCarArtwork } from './types';
import { ROLLING_STOCK_ART } from './skins/rollingStock';
import { CLASSIC_ART } from './skins/classic';

export type { TrainCarArtSet, TrainCarArtwork } from './types';

export const TRAIN_CAR_SKIN_ART: Record<TrainCarSkin, TrainCarArtSet> = {
  rollingStock: ROLLING_STOCK_ART,
  classic: CLASSIC_ART,
};

/** The default pack's artwork — what a card wears unless the viewer picked another skin. */
export const TRAIN_CAR_ART: TrainCarArtSet = TRAIN_CAR_SKIN_ART[DEFAULT_TRAIN_CAR_SKIN];

/** One card's artwork in one pack, with the pack's own metadata (name/model/viewBox) intact. */
export function trainCarArtwork(
  color: CardColor,
  skin: TrainCarSkin = DEFAULT_TRAIN_CAR_SKIN,
): TrainCarArtwork {
  return (TRAIN_CAR_SKIN_ART[skin] ?? TRAIN_CAR_ART)[color];
}

/** Resolve one illustration's ink placeholders against the light or night palette. */
export function trainCarArt(
  color: CardColor,
  dark: boolean,
  skin: TrainCarSkin = DEFAULT_TRAIN_CAR_SKIN,
): { viewBox: string; body: string } {
  const art = trainCarArtwork(color, skin);
  const palette = dark ? art.paletteDark : art.palette;
  return {
    viewBox: art.viewBox,
    body: art.body.replace(/\$(\d+)/g, (_, i: string) => palette[Number(i)] ?? '#000'),
  };
}

/** A standalone `<svg>…</svg>` document — what react-native-svg's SvgXml parses. */
export function trainCarSvg(
  color: CardColor,
  dark: boolean,
  skin: TrainCarSkin = DEFAULT_TRAIN_CAR_SKIN,
): string {
  const { viewBox, body } = trainCarArt(color, dark, skin);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}
