import { render } from '@testing-library/react-native';
import {
  TAIWAN_CONTENT,
  TAIWAN_BASE_VIEW,
  buildRouteGeometryFor,
  computeHubsFor,
} from '@trm/map-data';
import { MapSceneSkia } from './MapSceneSkia';

// Skia is the lightweight __mocks__ stub here (inert elements + truthy SkPath), so this exercises
// the layer composition + prop wiring — not native rendering. It guards against a runtime error in
// any layer (a bad element/prop, a null path deref) that typecheck can't catch.
const { geometry } = buildRouteGeometryFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);
const hubs = computeHubsFor(TAIWAN_CONTENT.cities, TAIWAN_CONTENT.routes);

describe('MapSceneSkia', () => {
  it('renders the full Taiwan scene without crashing (base network)', () => {
    expect(() =>
      render(
        <MapSceneSkia
          cities={TAIWAN_CONTENT.cities}
          routes={TAIWAN_CONTENT.routes}
          geometry={geometry}
          hubs={hubs}
          geography={null}
          view={TAIWAN_BASE_VIEW}
          bucket="district"
          inv={0.53}
          marker={0.72}
        />,
      ),
    ).not.toThrow();
  });

  it('renders with game state — ownership, stations, glow, targets, colour-blind', () => {
    const firstRoute = TAIWAN_CONTENT.routes[0]!;
    const secondRoute = TAIWAN_CONTENT.routes[1]!;
    const firstCity = TAIWAN_CONTENT.cities[0]!;
    expect(() =>
      render(
        <MapSceneSkia
          cities={TAIWAN_CONTENT.cities}
          routes={TAIWAN_CONTENT.routes}
          geometry={geometry}
          hubs={hubs}
          geography={null}
          view={TAIWAN_BASE_VIEW}
          owned={
            new Map([
              [firstRoute.id, { ownerSeat: 0 }],
              [secondRoute.id, { locked: true }],
            ])
          }
          stations={new Map([[firstCity.id, 1]])}
          glowingRoutes={new Map([[firstRoute.id, 0]])}
          glowingStations={new Map([[firstCity.id, 1]])}
          highlightCities={new Set([firstCity.id])}
          colorBlind
          cityLabel={(c) => c.id}
          cityTier={() => 'major'}
          bucket="local"
          inv={0.3}
          marker={1.1}
        />,
      ),
    ).not.toThrow();
  });
});
