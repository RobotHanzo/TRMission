/**
 * Lightweight jest mock for @shopify/react-native-skia.
 *
 * The library's shipped mock (`lib/commonjs/mock`) is a factory that needs a CanvasKit WASM
 * instance to build a real Skia API — heavy and slow for logic tests. Our board tests only need
 * (a) inert component stubs so `@testing-library/react-native` can render the tree without native
 * GL and (b) a truthy `SkPath` from `Skia.Path.MakeFromSVGString`. Real device rendering uses the
 * genuine Skia. Jest applies this automatically for every mobile test because it is a node_modules
 * manual mock under `<rootDir>/__mocks__` (no `jest.mock` call needed).
 */
const React = require('react');

// Each Skia element renders as a prop-ignoring passthrough (a component that returns its children),
// so no invalid props ever reach a host view and the tree stays shallow.
const stub = (name) => {
  const C = ({ children }) =>
    children == null ? null : React.createElement(React.Fragment, null, children);
  C.displayName = name;
  return C;
};

const COMPONENT_NAMES = [
  'Canvas',
  'Group',
  'Path',
  'Rect',
  'RoundedRect',
  'Circle',
  'Line',
  'Points',
  'Paint',
  'LinearGradient',
  'RadialGradient',
  'DashPathEffect',
  'Blur',
  'Paragraph',
  'Text',
  'Fill',
  'Mask',
];
const components = Object.fromEntries(COMPONENT_NAMES.map((n) => [n, stub(n)]));

const fakePath = () => ({ __skPath: true });

module.exports = {
  ...components,
  vec: (x = 0, y = 0) => ({ x, y }),
  rect: (x, y, width, height) => ({ x, y, width, height }),
  rrect: (r, rx, ry) => ({ rect: r, rx, ry }),
  TextAlign: { Left: 0, Right: 1, Center: 2, Justify: 3, Start: 4, End: 5 },
  // Runtime enums referenced as plain values in the board tree (e.g. LabelLayer's `weight` prop),
  // so they must exist even though the mock draws no real text — an undefined enum would throw
  // before BoardText's Paragraph guard is ever reached.
  FontWeight: { Normal: 400, Medium: 500, SemiBold: 600, Bold: 700 },
  PaintStyle: { Fill: 0, Stroke: 1 },
  StrokeJoin: { Miter: 0, Round: 1, Bevel: 2 },
  Skia: {
    Path: { MakeFromSVGString: () => fakePath(), Make: () => fakePath() },
    Color: (c) => c,
    // FontMgr / ParagraphBuilder / Paint / PathBuilder are intentionally omitted: BoardText and the
    // tutorial scrim guard on their absence and render no text / fall back in jest (labels and the
    // halo are a device-only progressive enhancement over the always-visible markers).
  },
};
