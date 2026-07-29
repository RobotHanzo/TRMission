import { useMemo } from 'react';
import type { CardColor } from '@trm/shared';
import { trainCarArt } from '@trm/client-core/art/trainCars';
import { useIsDark } from '../theme/useIsDark';

/**
 * The rolling-stock illustration for one card colour — the authored side elevations from
 * `@trm/client-core/art/trainCars` (普悠瑪, 太魯閣, 610型 …, with R20型's rainbow livery standing
 * in for the wild LOCOMOTIVE). The artwork itself is shared with apps/mobile; only this renderer
 * is web — mobile parses the same body through react-native-svg.
 *
 * The sheets are drawn for a near-black page, so a dark card gets the night livery: the same
 * markup resolved against a dimmed palette (see the module's own notes). That is a palette swap
 * in TS rather than a stylesheet, so both clients take one code path.
 */
export function TrainCarArt({ color }: { color: CardColor }) {
  const dark = useIsDark();
  const { viewBox, body } = useMemo(() => trainCarArt(color, dark), [color, dark]);
  return (
    <svg
      viewBox={viewBox}
      className="rs-art"
      aria-hidden
      focusable="false"
      // Build-time artwork from the repo's own sheets — never user input.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
