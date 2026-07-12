import { TAIWAN_CONTENT, TAIWAN_BASE_VIEW } from '@trm/map-data';
import type { GameContent, MapGeography } from '@trm/map-data';
import { applyContentTables } from './content';
import { rebuildRouteGeometry } from './routeGeometry';

// Mobile has no game/geography.ts (that file is web-only pan/zoom concerns); inline the base view.
export type View = { x: number; y: number; w: number; h: number };
const BASE_VIEW: View = TAIWAN_BASE_VIEW;

// The single place allowed to swap the active board content (content.ts + routeGeometry.ts stay
// one-directional — routeGeometry reads content, content knows nothing of routeGeometry — so this
// orchestrator sits above both instead of introducing a cycle between them).

/** The active map's viewBox; falls back to the hand-authored Taiwan framing when the content
 *  carries no geography (the Taiwan official map, or any future official map without custom art). */
export let ACTIVE_BASE_VIEW: View = BASE_VIEW;

/** The active map's cropped-world cartography, or null to render the hand-authored Taiwan coast. */
export let ACTIVE_GEOGRAPHY: MapGeography | null = null;

export function setActiveContent(content: GameContent): void {
  applyContentTables(content);
  rebuildRouteGeometry();
  ACTIVE_BASE_VIEW = content.geography?.baseView ?? BASE_VIEW;
  ACTIVE_GEOGRAPHY = content.geography ?? null;
}

export function resetToDefaultContent(): void {
  setActiveContent(TAIWAN_CONTENT);
}
