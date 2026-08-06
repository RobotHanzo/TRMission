import { useMemo } from 'react';
import type { CardColor } from '@trm/shared';
import { trainCarArt } from '@trm/client-core/art/trainCars';
import { useIsDark } from '../theme/useIsDark';
import { useTrainCarSkin } from '../theme/useTrainCarSkin';

/**
 * The train-car illustration for one card colour, in the viewer's chosen skin pack — the
 * authored side elevations by default (普悠瑪, 太魯閣, 610型 …, with R20型's rainbow livery
 * standing in for the wild LOCOMOTIVE), or the original hand-drawn carriage under `classic`.
 * The artwork itself is shared with apps/mobile; only this renderer is web — mobile parses the
 * same body through react-native-svg.
 *
 * The default sheets are drawn for a near-black page, so a dark card gets the night livery: the
 * same markup resolved against a dimmed palette. That is a palette swap in TS rather than a
 * stylesheet, so both clients (and every pack) take one code path.
 *
 * The packs have different proportions, so the card's art band is per-skin — `rs-skin-*` in
 * game.css, which is the only place a pack's geometry lives on this platform.
 */
export function TrainCarArt({ color }: { color: CardColor }) {
  const dark = useIsDark();
  const skin = useTrainCarSkin();
  const { viewBox, body } = useMemo(() => trainCarArt(color, dark, skin), [color, dark, skin]);
  return (
    <svg
      viewBox={viewBox}
      className={`rs-art rs-skin-${skin}`}
      aria-hidden
      focusable="false"
      // Build-time artwork from the repo's own sheets — never user input.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
