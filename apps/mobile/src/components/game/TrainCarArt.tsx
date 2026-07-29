// The rolling-stock illustration for one card colour — the authored side elevations from
// @trm/client-core/art/trainCars (普悠瑪, 太魯閣, 610型 …, with R20型's rainbow livery standing in
// for the wild LOCOMOTIVE). The ARTWORK is shared with apps/web; only this renderer is native.
//
// The shared module inlines every style as a presentation attribute and tokenises every ink, so
// there is no CSS for react-native-svg to miss and the night livery is a palette swap rather
// than a media query — the same code path both clients take. Parsing is memoised per
// (colour, theme): 18 combinations for the whole app.
import { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import type { CardColor } from '@trm/shared';
import { trainCarSvg } from '@trm/client-core/art/trainCars';
import { useTheme } from '../../theme/useTheme';

const CACHE = new Map<string, string>();

function svgFor(color: CardColor, dark: boolean): string {
  const key = `${color}:${dark ? 'd' : 'l'}`;
  let xml = CACHE.get(key);
  if (xml === undefined) {
    xml = trainCarSvg(color, dark);
    CACHE.set(key, xml);
  }
  return xml;
}

export function TrainCarArt({ color }: { color: CardColor }) {
  const { dark } = useTheme();
  const xml = useMemo(() => svgFor(color, dark), [color, dark]);
  return <SvgXml xml={xml} width="100%" height="100%" />;
}
