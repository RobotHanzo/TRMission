import type { TicketDef, MapGeography, TicketView } from './types';

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export interface ViewXY {
  readonly x: number;
  readonly y: number;
}

export const TICKET_ZOOM_MIN = 0;
export const TICKET_ZOOM_MAX = 1;

// Auto-crop tuning (board units, 0..100 space).
const AUTO_PAD_FRAC = 0.6; // padding as a fraction of the larger endpoint span
const AUTO_PAD_MIN = 8; // minimum padding on each side
const AUTO_MIN_SPAN = 25; // minimum box edge, so two near cities aren't a pinhole
const ZOOM_TIGHT_FRAC = 0.18; // box size at zoom level 1, as a fraction of baseView

const clampNum = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
// Render-only rect, so round to 2 dp for clean viewBox strings and float-noise-free output.
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Shrink a rect to fit inside `base`, then slide it back inside `base`. */
function clampToBase(r: ViewRect, base: ViewRect): ViewRect {
  const w = Math.min(r.w, base.w);
  const h = Math.min(r.h, base.h);
  const x = clampNum(r.x, base.x, base.x + base.w - w);
  const y = clampNum(r.y, base.y, base.y + base.h - h);
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(h) };
}

const centeredRect = (cx: number, cy: number, w: number, h: number): ViewRect => ({
  x: cx - w / 2,
  y: cy - h / 2,
  w,
  h,
});

/** ticket.view ?? geography.defaultTicketView ?? whole-map. */
export function ticketViewSpec(
  ticket: Pick<TicketDef, 'view'>,
  geo?: Pick<MapGeography, 'defaultTicketView'>,
): TicketView {
  return ticket.view ?? geo?.defaultTicketView ?? { mode: 'full' };
}

/** Resolve a spec + the ticket's two endpoints into an SVG viewBox rectangle inside `base`. */
export function ticketViewRect(spec: TicketView, a: ViewXY, b: ViewXY, base: ViewRect): ViewRect {
  if (spec.mode === 'full') return base;

  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;

  if (spec.mode === 'auto') {
    const spanX = Math.abs(a.x - b.x);
    const spanY = Math.abs(a.y - b.y);
    const pad = Math.max(AUTO_PAD_MIN, AUTO_PAD_FRAC * Math.max(spanX, spanY));
    const w = Math.max(spanX + 2 * pad, AUTO_MIN_SPAN);
    const h = Math.max(spanY + 2 * pad, AUTO_MIN_SPAN);
    return clampToBase(centeredRect(cx, cy, w, h), base);
  }

  // zoom
  const level = clampNum(spec.level, TICKET_ZOOM_MIN, TICKET_ZOOM_MAX);
  const factor = 1 - level * (1 - ZOOM_TIGHT_FRAC);
  return clampToBase(centeredRect(cx, cy, base.w * factor, base.h * factor), base);
}

/** Convenience: resolve precedence and compute the rect in one call. */
export function ticketRect(
  ticket: Pick<TicketDef, 'view'>,
  a: ViewXY,
  b: ViewXY,
  base: ViewRect,
  geo?: Pick<MapGeography, 'defaultTicketView'>,
): ViewRect {
  return ticketViewRect(ticketViewSpec(ticket, geo), a, b, base);
}
