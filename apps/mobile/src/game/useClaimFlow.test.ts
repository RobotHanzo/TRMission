import { renderHook, act } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase, type GameSnapshot } from '@trm/proto';
import type { CardColor } from '@trm/shared';
import { ROUTES } from './content';
import { paymentToProto } from './payments';
import { useClaimFlow } from './useClaimFlow';
import { useAnimations } from '../store/animations';
import type { GameCommands } from '../net/commands';

// Real content routes so payments enumerate against true costs.
const colorRoute = ROUTES.find((r) => !r.isTunnel && r.ferryLocos === 0 && r.color !== 'GRAY')!;
const tunnelRoute = ROUTES.find((r) => r.isTunnel && r.color !== 'GRAY') ?? null;

const commandsMock = (): jest.Mocked<GameCommands> => ({
  keepInitialTickets: jest.fn(),
  keepTickets: jest.fn(),
  drawBlind: jest.fn(),
  drawFaceUp: jest.fn(),
  drawTickets: jest.fn(),
  claimRoute: jest.fn(),
  buildStation: jest.fn(),
  resolveTunnel: jest.fn(),
  relocateLanternHost: jest.fn(),
  repairRoute: jest.fn(),
  nightMarketSwap: jest.fn(),
  chooseEventPerk: jest.fn(),
  startHiveDraw: jest.fn(),
  continueHiveDraw: jest.fn(),
  stopHiveDraw: jest.fn(),
  pass: jest.fn(),
  cameraUpdate: jest.fn(),
});

const handOf = (color: CardColor | string, n: number, locos = 0): Record<string, number> => ({
  [String(color).toLowerCase()]: n,
  locomotive: locos,
});

const snap = (
  hand: Record<string, number>,
  overrides: Record<string, unknown> = {},
): GameSnapshot =>
  create(GameSnapshotSchema, {
    phase: Phase.AWAIT_ACTION,
    currentPlayerId: 'me',
    players: [{ id: 'me', seat: 0, trainCars: 45, stationsRemaining: 3 }],
    you: { playerId: 'me', hand },
    ...overrides,
  });

beforeEach(() => {
  useAnimations.getState().reset();
});

describe('useClaimFlow', () => {
  it('pickRoute with an affording hand opens the payment claim', () => {
    const commands = commandsMock();
    const s = snap(handOf(colorRoute.color, colorRoute.length + 1));
    const { result } = renderHook(() => useClaimFlow(s, commands));
    act(() => result.current.pickRoute(colorRoute.id as string));
    expect(result.current.claim).not.toBeNull();
    expect(result.current.claim?.kind).toBe('route');
    expect(
      result.current.claim && result.current.claim.kind === 'route'
        ? result.current.claim.payments.length
        : 0,
    ).toBeGreaterThan(0);
  });

  it('pickRoute with an empty hand pushes the shortfall notice and opens nothing', () => {
    const commands = commandsMock();
    const { result } = renderHook(() => useClaimFlow(snap({}), commands));
    act(() => result.current.pickRoute(colorRoute.id as string));
    expect(result.current.claim).toBeNull();
    const notes = useAnimations.getState().notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ variant: 'notice' });
  });

  it('cancelClaim drops the pending claim without sending anything', () => {
    const commands = commandsMock();
    const s = snap(handOf(colorRoute.color, colorRoute.length + 1));
    const { result } = renderHook(() => useClaimFlow(s, commands));
    act(() => result.current.pickRoute(colorRoute.id as string));
    act(() => result.current.cancelClaim());
    expect(result.current.claim).toBeNull();
    expect(commands.claimRoute).not.toHaveBeenCalled();
  });

  it('confirmPayment claims the route with the proto payment and clears the claim', () => {
    const commands = commandsMock();
    const s = snap(handOf(colorRoute.color, colorRoute.length + 1));
    const { result } = renderHook(() => useClaimFlow(s, commands));
    act(() => result.current.pickRoute(colorRoute.id as string));
    const payment =
      result.current.claim?.kind === 'route' ? result.current.claim.payments[0]! : null;
    act(() => result.current.confirmPayment(payment!));
    expect(commands.claimRoute).toHaveBeenCalledWith(
      colorRoute.id,
      expect.objectContaining({ colorCount: payment!.colorCount }),
    );
    expect(result.current.claim).toBeNull();
  });

  (tunnelRoute ? it : it.skip)(
    'a tunnel claim stashes the base payment: the surcharge enumerates against the REMAINING hand',
    () => {
      const commands = commandsMock();
      const tr = tunnelRoute!;
      // Exactly length+1 of the colour: after paying `length` for the base, 1 card remains.
      const s1 = snap(handOf(tr.color, tr.length + 1));
      const { result, rerender } = renderHook(
        ({ s }: { s: GameSnapshot }) => useClaimFlow(s, commands),
        { initialProps: { s: s1 } },
      );
      act(() => result.current.pickRoute(tr.id as string));
      const base =
        result.current.claim?.kind === 'route' ? result.current.claim.payments[0]! : null;
      act(() => result.current.confirmPayment(base!));
      expect(commands.claimRoute).toHaveBeenCalled();

      // Server answers with a pending tunnel needing 2 extra — but only 1 card remains after the
      // base, so the only surcharge options must fit the remaining hand (none afford 2).
      const s2 = snap(handOf(tr.color, tr.length + 1), {
        phase: Phase.TUNNEL_PENDING,
        pendingTunnel: {
          playerId: 'me',
          extraRequired: 2,
          revealed: [],
          playedColor: paymentToProto(base!).color,
        },
      });
      rerender({ s: s2 });
      expect(result.current.tunnelMine).toBe(true);
      expect(result.current.tunnelExtras).toHaveLength(0);

      // With 1 extra required, the single remaining colour card affords exactly one option.
      const s3 = snap(handOf(tr.color, tr.length + 1), {
        phase: Phase.TUNNEL_PENDING,
        pendingTunnel: {
          playerId: 'me',
          extraRequired: 1,
          revealed: [],
          playedColor: paymentToProto(base!).color,
        },
      });
      rerender({ s: s3 });
      expect(result.current.tunnelExtras.length).toBeGreaterThan(0);

      act(() => result.current.onTunnelCommit(result.current.tunnelExtras[0]!));
      expect(commands.resolveTunnel).toHaveBeenCalledWith(true, expect.anything());
    },
  );

  it('onTunnelAbort resolves the tunnel negatively', () => {
    const commands = commandsMock();
    const { result } = renderHook(() => useClaimFlow(snap({}), commands));
    act(() => result.current.onTunnelAbort());
    expect(commands.resolveTunnel).toHaveBeenCalledWith(false);
  });

  it('pickCity with no stations left pushes the noStationsLeft notice', () => {
    const commands = commandsMock();
    const s = snap(handOf('RED', 5), {
      players: [{ id: 'me', seat: 0, trainCars: 45, stationsRemaining: 0 }],
    });
    const { result } = renderHook(() => useClaimFlow(s, commands));
    act(() => result.current.pickCity('anywhere'));
    expect(result.current.claim).toBeNull();
    const notes = useAnimations.getState().notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ variant: 'notice' });
  });

  it('pickCity with stations + cards opens a station claim priced by stations used', () => {
    const commands = commandsMock();
    const s = snap(handOf('RED', 5), {
      players: [{ id: 'me', seat: 0, trainCars: 45, stationsRemaining: 2 }],
    });
    const { result } = renderHook(() => useClaimFlow(s, commands));
    act(() => result.current.pickCity('taipei'));
    expect(result.current.claim?.kind).toBe('station');
    const payment =
      result.current.claim?.kind === 'station' ? result.current.claim.payments[0]! : null;
    // Second station costs 2 cards.
    expect(payment!.colorCount + payment!.locomotives).toBe(2);
    act(() => result.current.confirmPayment(payment!));
    expect(commands.buildStation).toHaveBeenCalledWith('taipei', expect.anything());
  });
});
