// Pure helpers shared by the spotlight overlay, the coachmark, and the scenario-rot test.
import type { Spotlight } from './types';

/** HUD spotlight selectors the tutorial is allowed to target. Every entry MUST resolve to a real
 *  element in the live HUD — a selector that matches nothing leaves the spotlight with no cutout,
 *  which degrades to a whole-screen dim that hides the very element being taught. (The DOM roots:
 *  `.market` = CardMarket, `.trackers` = PlayerTrackers, the `data-anim` hooks live on the deck
 *  button, face-up slots, hand, and missions tray.) Validated by scenarios.test.ts. */
export const HUD_SPOTLIGHT_SELECTORS = [
  '.market',
  '.trackers',
  '.board-viewport',
  '.ticket-chooser',
  '[data-anim="deck"]',
  '[data-anim="market-slot"]',
  '[data-anim="hand"]',
  '[data-anim="tickets"]',
] as const;

export function isAllowedHudSelector(sel: string): boolean {
  return (HUD_SPOTLIGHT_SELECTORS as readonly string[]).includes(sel);
}

/** Resolve a beat's spotlight to the CSS selectors whose on-screen rects should be lit. */
export function selectorsForSpotlight(spotlight: Spotlight | undefined): string[] {
  if (!spotlight) return [];
  switch (spotlight.kind) {
    case 'cities':
      return spotlight.ids.map((id) => `[data-city-id="${id}"]`);
    case 'route':
      return spotlight.ids.map((id) => `[data-route-id="${id}"]`);
    case 'hud':
      return [spotlight.selector];
    case 'board':
      return [];
  }
}

export interface FlatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CoachPos = 'bottom' | 'top' | 'left' | 'right';

/** The union (bounding box) of a set of rects, or null when empty. */
function unionRect(rects: FlatRect[]): FlatRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Where to anchor the coachmark so it never covers the spotlighted element — and so its caret
 * points TOWARD that element. A target that fills most of the viewport height (the whole board, the
 * ticket chooser) can't be cleared by moving up or down, so the coach docks to the side opposite the
 * target's horizontal centre. Otherwise the coach anchors on the vertical half opposite the target,
 * so the caret on its facing edge points at the target.
 */
export function coachPosition(rects: FlatRect[], vw: number, vh: number): CoachPos {
  const u = unionRect(rects);
  if (!u) return 'bottom';
  // A tall target (most of the height) can't be dodged vertically — dock to the roomier side.
  if (u.h > vh * 0.6) return u.x + u.w / 2 < vw / 2 ? 'right' : 'left';
  // Otherwise anchor opposite the target's vertical centre (caret then points back at it).
  return u.y + u.h / 2 < vh / 2 ? 'bottom' : 'top';
}

/** Centre of the union of a beat's spotlight rects, used to aim the coachmark caret. */
export function spotlightCentre(rects: FlatRect[]): { x: number; y: number } | null {
  const u = unionRect(rects);
  return u ? { x: u.x + u.w / 2, y: u.y + u.h / 2 } : null;
}
