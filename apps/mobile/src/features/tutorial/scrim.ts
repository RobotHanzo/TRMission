// Pure geometry for the spotlight scrim: one SVG path = full-screen rect + a rounded-rect
// subpath per target; drawn with even-odd fill so the targets become holes of light. The PAD
// and RADIUS match the web's TutorialSpotlight so both platforms frame targets identically.
import type { FlatRect } from './focus';

export const SPOT_PAD = 10;
export const SPOT_RADIUS = 14;

function holeSubpath(r: FlatRect): string {
  const x = r.x - SPOT_PAD;
  const y = r.y - SPOT_PAD;
  const w = r.w + SPOT_PAD * 2;
  const h = r.h + SPOT_PAD * 2;
  const rad = Math.min(SPOT_RADIUS, w / 2, h / 2);
  return [
    `M${x + rad} ${y}`,
    `H${x + w - rad}`,
    `A${rad} ${rad} 0 0 1 ${x + w} ${y + rad}`,
    `V${y + h - rad}`,
    `A${rad} ${rad} 0 0 1 ${x + w - rad} ${y + h}`,
    `H${x + rad}`,
    `A${rad} ${rad} 0 0 1 ${x} ${y + h - rad}`,
    `V${y + rad}`,
    `A${rad} ${rad} 0 0 1 ${x + rad} ${y}`,
    'Z',
  ].join(' ');
}

export function scrimPath(w: number, h: number, holes: FlatRect[]): string {
  return [`M0 0 H${w} V${h} H0 Z`, ...holes.map(holeSubpath)].join(' ');
}
