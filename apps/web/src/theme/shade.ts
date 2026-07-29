// Tiny deterministic colour helpers for the livery washes and tints the card/ticket chrome
// derives from a colour token. Pure hex maths (no color-mix) so it renders identically
// everywhere and is independent of the page theme.
//
// These once also drove the procedurally-drawn train cars; that artwork is now the authored
// sheets in @trm/client-core/art/trainCars, which carry their own inks, so the shading helpers
// they needed (shade/tint/luminance) are gone.

type Rgb = readonly [number, number, number];

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

const parse = (hex: string): Rgb => {
  let h = hex.replace('#', '').trim();
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: Rgb): string =>
  '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');

/** Linear blend between two hex colours; t=0 → a, t=1 → b. */
export const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
};

/** `rgba()` string from a hex + alpha — used for theme-friendly colour washes. */
export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
