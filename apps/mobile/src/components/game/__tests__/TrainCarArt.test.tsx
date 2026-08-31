// react-native-svg parses the shared artwork at runtime (SvgXml), so a body it cannot handle
// fails HERE rather than as a blank card on a device. That is the whole risk of sharing one SVG
// with the DOM client: anything CSS-only, or any element the native parser lacks, renders as
// nothing. These assert the parse produces real drawing nodes, in both themes, for all nine
// cards — in EVERY skin pack, since a pack is exactly a new set of bodies to parse.
import { render } from '@testing-library/react-native';
import { CARD_COLORS, TRAIN_CAR_SKINS, type TrainCarSkin } from '@trm/shared';
import { TRAIN_CAR_ART } from '@trm/client-core/art/trainCars';

import { TrainCarArt } from '../TrainCarArt';
import { TrainCarCard } from '../TrainCarCard';

const mockDark = jest.fn(() => false);
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({ dark: mockDark(), tokens: {} }),
}));

const mockSkin = jest.fn<TrainCarSkin, []>(() => 'rollingStock');
jest.mock('../../../theme/useTrainCarSkin', () => ({
  useTrainCarSkin: () => mockSkin(),
}));

/** Every drawing primitive in the tree, by react-native-svg element name. */
function shapeCount(json: unknown): number {
  const SHAPES = new Set(['RNSVGPath', 'RNSVGRect', 'RNSVGCircle', 'RNSVGLine', 'RNSVGEllipse']);
  let n = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const el = node as { type?: string; children?: unknown };
    if (typeof el.type === 'string' && SHAPES.has(el.type)) n++;
    if (el.children) walk(el.children);
  };
  walk(json);
  return n;
}

describe('TrainCarArt', () => {
  afterEach(() => {
    mockDark.mockReturnValue(false);
    mockSkin.mockReturnValue('rollingStock');
  });

  describe.each(TRAIN_CAR_SKINS)('%s', (skin) => {
    it.each(CARD_COLORS)('renders %s as real SVG shapes', async (color) => {
      mockSkin.mockReturnValue(skin);
      const tree = (await render(<TrainCarArt color={color} />)).toJSON();
      // the sparsest car (the open wagon) still draws dozens of shapes
      expect(shapeCount(tree)).toBeGreaterThan(20);
    });
  });

  it('renders the night livery when the theme is dark', async () => {
    mockDark.mockReturnValue(true);
    const dark = JSON.stringify((await render(<TrainCarArt color="RED" />)).toJSON());
    mockDark.mockReturnValue(false);
    const light = JSON.stringify((await render(<TrainCarArt color="RED" />)).toJSON());

    expect(dark).not.toEqual(light);
    // 普悠瑪's white body dims; its red livery band does not.
    const { palette, paletteDark } = TRAIN_CAR_ART.RED;
    const dimmed = paletteDark[palette.indexOf('#ffffff')]!;
    expect(dark).toContain(dimmed);
    expect(light).not.toContain(dimmed);
  });

  it('draws different artwork per skin', async () => {
    const rolling = JSON.stringify((await render(<TrainCarArt color="RED" />)).toJSON());
    mockSkin.mockReturnValue('classic');
    const classic = JSON.stringify((await render(<TrainCarArt color="RED" />)).toJSON());
    expect(classic).not.toEqual(rolling);
  });
});

describe('TrainCarCard layout', () => {
  const flat = (s: unknown): Record<string, number> =>
    Object.assign({}, ...(Array.isArray(s) ? s.flat(9) : [s]).filter(Boolean));

  const ASPECT: Record<TrainCarSkin, number> = {
    rollingStock: 176 / 79,
    classic: 132 / 72,
  };

  /** Where the drawing actually lands: the skin's band, then a 'meet' fit inside it. */
  async function measure(skin: TrainCarSkin) {
    mockSkin.mockReturnValue(skin);
    const tree = (await render(<TrainCarCard color="RED" count={3} />)).toJSON();
    const nodes: { style: Record<string, number> }[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return void n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const el = n as { props?: { style?: unknown }; children?: unknown };
      if (el.props?.style) nodes.push({ style: flat(el.props.style) });
      if (el.children) walk(el.children);
    };
    walk(tree);

    const card = nodes.find((n) => n.style.borderRadius === 8 && n.style.width !== undefined)!;
    const art = nodes.find((n) => n.style.top !== undefined && n.style.bottom !== undefined)!;
    const chips = nodes.filter((n) => n.style.bottom === 4);
    expect(card).toBeDefined();
    expect(art).toBeDefined();
    expect(chips.length).toBeGreaterThanOrEqual(2); // glyph + count

    const h = card.style.height;
    const bandH = h - art.style.top - art.style.bottom;
    const bandW = card.style.width - 2 * (art.style.left ?? 0);
    const drawnH = Math.min(bandH, bandW / ASPECT[skin]);
    return {
      cardH: h,
      artTop: art.style.top + (bandH - drawnH) / 2,
      artBottom: art.style.top + (bandH - drawnH) / 2 + drawnH,
      chipTop: Math.min(...chips.map((c) => h - c.style.bottom - (c.style.height ?? 15))),
    };
  }

  afterEach(() => mockSkin.mockReturnValue('rollingStock'));

  it.each(TRAIN_CAR_SKINS)('keeps %s artwork inside the card face', async (skin) => {
    const { cardH, artTop, artBottom } = await measure(skin);
    expect(artTop).toBeGreaterThanOrEqual(5); // clear of the colour edge band
    expect(artBottom).toBeLessThanOrEqual(cardH);
  });

  // The default illustration is ~2.2:1 and runs the full card width, so inside its band it is
  // HEIGHT-bound: shrink the band and the drawn vehicle grows past it, putting the underframe
  // behind the chips. The first cut of this card did exactly that (4dp of overlap), hence the
  // arithmetic. This is a property of THAT band, not of every skin — `classic` is a 132×72
  // drawing that has always filled the face with the chips over its corners, which is the look
  // being preserved, so it deliberately does not reserve the chip row.
  it('leaves the rolling-stock artwork clear of the glyph and count chips', async () => {
    const { artBottom, chipTop } = await measure('rollingStock');
    expect(artBottom).toBeLessThanOrEqual(chipTop);
  });
});
