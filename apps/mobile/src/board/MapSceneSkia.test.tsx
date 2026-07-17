import { render } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  TAIWAN_CONTENT,
  TAIWAN_BASE_VIEW,
  buildRouteGeometryFor,
  computeHubsFor,
} from '@trm/map-data';
import { create } from '@bufbuild/protobuf';
import { RandomEventsStateSchema } from '@trm/proto';
import { boardEventOverlays } from '../game/events';
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

  it('renders with the UI-thread motion/zoom guard shared values wired', () => {
    function Scene({ moving, zooming }: { moving: boolean; zooming: boolean }) {
      const motionSV = useSharedValue(moving);
      const zoomingSV = useSharedValue(zooming);
      return (
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
          motionSV={motionSV}
          zoomingSV={zoomingSV}
        />
      );
    }
    expect(() => render(<Scene moving={false} zooming={false} />)).not.toThrow();
    expect(() => render(<Scene moving zooming={false} />)).not.toThrow();
    expect(() => render(<Scene moving zooming />)).not.toThrow();
  });

  it('renders the full random-events overlay set without crashing', () => {
    const [r1, r2, r3, r4] = TAIWAN_CONTENT.routes;
    const [c1, c2, c3, c4, c5, c6] = TAIWAN_CONTENT.cities;
    const events = boardEventOverlays(
      create(RandomEventsStateSchema, {
        mode: 'intense',
        roundIndex: 3,
        closedRouteIds: [r1!.id],
        reopenBonusRouteIds: [r2!.id],
        hotspots: [{ cityId: c1!.id, level: 2 }],
        charters: [{ id: 'ch', cityA: c2!.id, cityB: c3!.id, points: 8, wonByPlayerId: '' }],
        luckyContracts: [
          { eventId: 'l', cityA: c4!.id, cityB: c5!.id, points: 4, wonByPlayerId: '' },
        ],
        lanternHost: { cityId: c6!.id },
        active: [
          { id: 's', kind: 'SKY_LANTERN', routeIds: [r3!.id] },
          { id: 'h', kind: 'HARVEST_FESTIVAL_EXPRESS', routeIds: [r4!.id] },
          { id: 'g', kind: 'GODDESS_PROCESSION', cityPath: [c1!.id, c2!.id, c3!.id], position: 1 },
          { id: 'b', kind: 'BENTO_RUSH', cityId: c4!.id },
          { id: 'n', kind: 'STATION_FRONT_NIGHT_MARKET', cityId: c5!.id },
        ],
      }),
    );
    expect(() =>
      render(
        <MapSceneSkia
          cities={TAIWAN_CONTENT.cities}
          routes={TAIWAN_CONTENT.routes}
          geometry={geometry}
          hubs={hubs}
          geography={null}
          view={TAIWAN_BASE_VIEW}
          events={events}
          bucket="local"
          inv={0.3}
          marker={1.1}
        />,
      ),
    ).not.toThrow();
  });
});
