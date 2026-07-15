import { memo, type CSSProperties } from 'react';
import { CITIES, ROUTES } from '../game/content';
import { ROUTE_GEOMETRY, HUB_CITIES } from '../game/routeGeometry';
import { BASE_VIEW } from '../game/geography';
import { MapScene } from './MapScene';
import '../styles/game.css';

// `.board` reads --inv-scale (≈1/zoom) for its track/marker weights, but that var is normally set
// live on the in-game `.board-viewport`. The backdrop has no viewport, so pin it to the home value.
const STATIC_BOARD_STYLE = { '--inv-scale': 0.53 } as CSSProperties;

/**
 * A static, non-interactive render of the Taiwan board — the same cartography and railway network
 * the game draws (through the same MapScene), in their base route colours, with no labels,
 * ownership, glow, or pan/zoom. Decorative only: the blurred backdrop on the login screen
 * (default class) and the sharp "station wall map" panel on the public landing page;
 * `preserveAspectRatio="slice"` makes it cover the area like `background-size: cover`.
 * `showFerryLocos={false}` keeps its quiet all-pips ferry look. Memoised: it never changes.
 */
export const MapBackdrop = memo(function MapBackdrop({
  className = 'login-backdrop',
  fit = 'cover',
}: {
  className?: string;
  /** 'cover' crops to fill (login blur); 'contain' shows the whole island (landing panel). */
  fit?: 'cover' | 'contain';
}) {
  return (
    <div className={className} aria-hidden>
      <MapScene
        cities={CITIES}
        routes={ROUTES}
        geometry={ROUTE_GEOMETRY}
        hubs={HUB_CITIES}
        view={BASE_VIEW}
        preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
        showFerryLocos={false}
        style={STATIC_BOARD_STYLE}
      />
    </div>
  );
});
