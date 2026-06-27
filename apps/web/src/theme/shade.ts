// Tiny deterministic colour helpers for deriving the shading used by the
// original train-car artwork. Pure hex maths (no color-mix) so it renders
// identically everywhere and is independent of the page theme.

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

/** Darken toward a warm near-black. */
export const shade = (hex: string, t: number): string => mix(hex, '#16120c', t);

/** Lighten toward white. */
export const tint = (hex: string, t: number): string => mix(hex, '#ffffff', t);

/** `rgba()` string from a hex + alpha — used for theme-friendly colour washes. */
export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Relative luminance (0..1) — used to pick light/dark glass tints per card colour. */
export const luminance = (hex: string): number => {
  const [r, g, b] = parse(hex).map((v) => v / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
