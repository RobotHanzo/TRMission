// react-native-svg parses the shared artwork at runtime (SvgXml), so a body it cannot handle
// fails HERE rather than as a blank card on a device. That is the whole risk of sharing one SVG
// with the DOM client: anything CSS-only, or any element the native parser lacks, renders as
// nothing. These assert the parse produces real drawing nodes, in both themes, for all nine cards.
import { render } from '@testing-library/react-native';
import { CARD_COLORS } from '@trm/shared';
import { TRAIN_CAR_ART } from '@trm/client-core/art/trainCars';

import { TrainCarArt } from '../TrainCarArt';
import { TrainCarCard } from '../TrainCarCard';

const mockDark = jest.fn(() => false);
jest.mock('../../../theme/useTheme', () => ({
  useTheme: () => ({ dark: mockDark(), tokens: {} }),
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
  afterEach(() => mockDark.mockReturnValue(false));

  it.each(CARD_COLORS)('renders %s as real SVG shapes', (color) => {
    const tree = render(<TrainCarArt color={color} />).toJSON();
    // the sparsest car (the open wagon) still draws dozens of shapes
    expect(shapeCount(tree)).toBeGreaterThan(20);
  });

  it('renders the night livery when the theme is dark', () => {
    mockDark.mockReturnValue(true);
    const dark = JSON.stringify(render(<TrainCarArt color="RED" />).toJSON());
    mockDark.mockReturnValue(false);
    const light = JSON.stringify(render(<TrainCarArt color="RED" />).toJSON());

    expect(dark).not.toEqual(light);
    // 普悠瑪's white body dims; its red livery band does not.
    const { palette, paletteDark } = TRAIN_CAR_ART.RED;
    const dimmed = paletteDark[palette.indexOf('#ffffff')]!;
    expect(dark).toContain(dimmed);
    expect(light).not.toContain(dimmed);
  });
});

describe('TrainCarCard layout', () => {
  // The illustration is ~2.2:1 and runs the full card width, so inside its band it is HEIGHT-bound:
  // shrink the band and the drawn vehicle grows past it, putting the underframe behind the chips.
  // The first cut of this card did exactly that (4dp of overlap), hence the arithmetic here.
  const flat = (s: unknown): Record<string, number> =>
    Object.assign({}, ...(Array.isArray(s) ? s.flat(9) : [s]).filter(Boolean));

  it('leaves the artwork clear of the glyph and count chips', () => {
    const tree = render(<TrainCarCard color="RED" count={3} />).toJSON();
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
    const bandTop = art.style.top;
    const bandH = h - art.style.top - art.style.bottom;
    // 'meet' fit inside the band: the drawn height is whichever axis binds
    const drawnH = Math.min(bandH, card.style.width / (176 / 79));
    const artBottom = bandTop + (bandH - drawnH) / 2 + drawnH;
    const chipTop = Math.min(...chips.map((c) => h - c.style.bottom - (c.style.height ?? 15)));

    expect(artBottom).toBeLessThanOrEqual(chipTop);
  });
});
