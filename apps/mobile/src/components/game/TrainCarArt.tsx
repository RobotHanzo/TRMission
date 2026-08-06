// The train-car illustration for one card colour, in the viewer's chosen skin pack — the
// authored side elevations from @trm/client-core/art/trainCars by default (普悠瑪, 太魯閣, 610型 …,
// with R20型's rainbow livery standing in for the wild LOCOMOTIVE), or the original hand-drawn
// carriage under `classic`. The ARTWORK is shared with apps/web; only this renderer is native.
//
// Every pack inlines its styles as presentation attributes and tokenises every ink, so there is
// no CSS for react-native-svg to miss and the night livery is a palette swap rather than a media
// query — the same code path both clients take. Parsing is memoised per (pack, colour, theme):
// 18 combinations per pack for the whole app.
import { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import type { CardColor, TrainCarSkin } from '@trm/shared';
import { trainCarSvg } from '@trm/client-core/art/trainCars';
import { useTheme } from '../../theme/useTheme';
import { useTrainCarSkin } from '../../theme/useTrainCarSkin';

const CACHE = new Map<string, string>();

function svgFor(color: CardColor, dark: boolean, skin: TrainCarSkin): string {
  const key = `${skin}:${color}:${dark ? 'd' : 'l'}`;
  let xml = CACHE.get(key);
  if (xml === undefined) {
    xml = trainCarSvg(color, dark, skin);
    CACHE.set(key, xml);
  }
  return xml;
}

export function TrainCarArt({ color }: { color: CardColor }) {
  const { dark } = useTheme();
  const skin = useTrainCarSkin();
  const xml = useMemo(() => svgFor(color, dark, skin), [color, dark, skin]);
  return <SvgXml xml={xml} width="100%" height="100%" />;
}
