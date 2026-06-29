// Pure helpers shared by the spotlight overlay, the coachmark, and the scenario-rot test.
import type { Spotlight } from './types';

/** HUD spotlight selectors the tutorial is allowed to target (validated by scenarios.test.ts). */
export const HUD_SPOTLIGHT_SELECTORS = [
  '.deck-area',
  '[data-anim="deck"]',
  '[data-anim="market-slot"]',
  '[data-anim="hand"]',
  '[data-anim="tickets"]',
  '.card-market',
  '.player-trackers',
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

/**
 * Where to anchor the bottom coachmark so it never covers the spotlighted element. If a target
 * sits in the lower band of the viewport, flip the coachmark to the top.
 */
export function coachPosition(rects: FlatRect[], vh: number): 'bottom' | 'top' {
  const lowBand = vh * 0.62;
  for (const r of rects) {
    const overlapsBottom = r.y + r.h > lowBand;
    // Any spotlight target sitting in the lower band of the viewport would be covered by the
    // bottom-anchored coachmark, so flip the coachmark to the top. (Vertical band only — the
    // authored bottom targets are horizontally central, so a horizontal check isn't needed.)
    if (overlapsBottom) return 'top';
  }
  return 'bottom';
}
