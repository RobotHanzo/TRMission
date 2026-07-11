import { describe, expect, it } from 'vitest';
import { asPlayerId, TRAIN_COLORS } from '@trm/shared';
import type { CardColor, PlayerId } from '@trm/shared';
import type { RouteDef } from '@trm/map-data';
import type { Board } from '../src/board';
import type { Payment } from '../src/types/actions';
import type { EventResources, EventScheduleEntry } from '../src/types/events-state';
import type { GameState } from '../src/types/state';
import { reduce, hasAnyLegalMove } from '../src/reduce';
import { legalActions } from '../src/selectors';
import { computeFinalScores } from '../src/scoring';
import { currentPlayerId, endTurn } from '../src/turn';
import { tickRound } from '../src/events/runtime';
import { effectiveTunnelRevealCount } from '../src/events/effects';
import {
  activeEvent,
  afterSetup,
  emptyEvents,
  handOf,
  handTotal,
  setPlayer,
  withEvents,
} from './events-helpers';

const p0 = asPlayerId('p0');
const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');

const EMPTY_RESOURCES: EventResources = {
  bentoTokens: 0,
  blessings: 0,
  claimDiscounts: 0,
  repairPermits: 0,
};

function simpleRoutes(board: Board): RouteDef[] {
  return board.content.routes.filter(
    (route) => !route.isTunnel && route.ferryLocos === 0 && route.doubleGroup === undefined,
  );
}

function stocked(state: GameState, player: PlayerId = p0): GameState {
  return setPlayer(state, player, {
    hand: handOf({
      RED: 12,
      ORANGE: 12,
      YELLOW: 12,
      GREEN: 12,
      BLUE: 12,
      PURPLE: 12,
      WHITE: 12,
      BLACK: 12,
      LOCOMOTIVE: 12,
    }),
    trainCars: 45,
  });
}

function routePayment(route: RouteDef, locomotives = route.ferryLocos): Payment {
  const colorCount = route.length - locomotives;
  return {
    color: colorCount === 0 ? null : route.color === 'GRAY' ? 'RED' : route.color,
    colorCount,
    locomotives,
  };
}

function resetToP0(state: GameState): GameState {
  return {
    ...state,
    turn: { orderIndex: 0, phase: 'AWAIT_ACTION', cardsDrawnThisTurn: 0 },
  };
}

function resources(patch: Partial<EventResources>): EventResources {
  return { ...EMPTY_RESOURCES, ...patch };
}

describe('future-event expansion mechanics', () => {
  it('Lantern Host City awards +6 and requires a valid post-claim relocation', () => {
    const base = afterSetup(2, 'future-lantern');
    const route = simpleRoutes(base.board)[0]!;
    const state = stocked(
      withEvents(base.state, {
        ...emptyEvents(),
        lanternHost: { eventId: 'lantern', cityId: route.a, points: 6 },
      }),
    );
    const before = state.players.p0!.routePoints;

    const claim = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: routePayment(route),
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.state.turn.phase).toBe('LANTERN_RELOCATION');
    expect(claim.value.state.players.p0!.routePoints).toBe(
      before + (state.ruleParams.routePoints[route.length] ?? 0) + 6,
    );
    expect(claim.value.state.events!.lanternPendingRelocation?.candidateCityIds).toContain(route.b);

    const move = reduce(base.board, claim.value.state, {
      t: 'RELOCATE_LANTERN_HOST',
      player: p0,
      cityId: route.b,
    });
    expect(move.ok).toBe(true);
    if (!move.ok) return;
    expect(move.value.state.events!.lanternHost?.cityId).toBe(route.b);
    expect(move.value.state.events!.lanternPendingRelocation).toBeUndefined();
    expect(currentPlayerId(move.value.state)).toBe(p1);
    expect(move.value.events.some((event) => event.e === 'EVENT_MARKER_MOVED')).toBe(true);
  });

  it('Bento Rush collects public tokens and supports both +2 and one-card-wild spends', () => {
    const base = afterSetup(2, 'future-bento');
    const first = simpleRoutes(base.board)[0]!;
    const second = simpleRoutes(base.board).find(
      (route) => route.id !== first.id && route.a !== first.a && route.b !== first.a,
    )!;
    let state = stocked(
      withEvents(base.state, {
        ...emptyEvents(),
        active: [activeEvent('BENTO_RUSH', { cityId: first.a })],
      }),
    );

    const collect = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: first.id,
      payment: routePayment(first),
    });
    expect(collect.ok).toBe(true);
    if (!collect.ok) return;
    expect(collect.value.state.events!.resources.p0?.bentoTokens).toBe(1);
    state = resetToP0(collect.value.state);
    const beforePoints = state.players.p0!.routePoints;
    const points = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: second.id,
      payment: { ...routePayment(second), bentoSpend: 'POINTS' },
    });
    expect(points.ok).toBe(true);
    if (!points.ok) return;
    expect(points.value.state.events!.resources.p0?.bentoTokens).toBe(0);
    expect(points.value.state.players.p0!.routePoints).toBe(
      beforePoints + (state.ruleParams.routePoints[second.length] ?? 0) + 2,
    );

    const wildRoute = simpleRoutes(base.board).find((route) => route.length >= 2)!;
    const payColor = wildRoute.color === 'GRAY' ? 'RED' : wildRoute.color;
    const wildState = setPlayer(
      withEvents(base.state, {
        ...emptyEvents(),
        resources: { p0: resources({ bentoTokens: 1 }) },
      }),
      p0,
      { hand: handOf({ [payColor]: wildRoute.length - 1 }), trainCars: 45 },
    );
    const wild = reduce(base.board, wildState, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: wildRoute.id,
      payment: {
        color: payColor,
        colorCount: wildRoute.length - 1,
        locomotives: 0,
        bentoSpend: 'WILD',
      },
    });
    expect(wild.ok).toBe(true);
    if (wild.ok) expect(wild.value.state.events!.resources.p0?.bentoTokens).toBe(0);
  });

  it('Slope Repair Order stays closed until a paid repair or saved permit reopens it for +3', () => {
    const base = afterSetup(2, 'future-slope');
    const route = simpleRoutes(base.board)[0]!;
    const closed = stocked(
      withEvents(base.state, {
        ...emptyEvents(),
        active: [activeEvent('SLOPE_REPAIR_ORDER', { routeIds: [route.id] })],
      }),
    );
    const blocked = reduce(base.board, closed, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: routePayment(route),
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('ROUTE_CLOSED_BY_EVENT');

    const before = closed.players.p0!.routePoints;
    const repaired = reduce(base.board, closed, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color: 'RED', colorCount: 2, locomotives: 0 },
    });
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.value.state.events!.repairedRouteIds).toContain(route.id);
    expect(repaired.value.state.players.p0!.routePoints).toBe(before + 3);

    const permitState = stocked(
      withEvents(base.state, {
        ...emptyEvents(),
        active: [activeEvent('SLOPE_REPAIR_ORDER', { routeIds: [route.id] })],
        resources: { p0: resources({ repairPermits: 1 }) },
      }),
    );
    const permit = reduce(base.board, permitState, {
      t: 'REPAIR_ROUTE',
      player: p0,
      routeId: route.id,
      payment: { color: null, colorCount: 0, locomotives: 0 },
    });
    expect(permit.ok).toBe(true);
    if (permit.ok) expect(permit.value.state.events!.resources.p0?.repairPermits).toBe(0);
  });

  it('Station-Front Night Market swaps directly with a face-up slot once before the main action', () => {
    const base = afterSetup(2, 'future-night-market');
    const ownedRoute = simpleRoutes(base.board)[0]!;
    const state = setPlayer(
      withEvents(
        {
          ...base.state,
          ownership: { [ownedRoute.id as string]: { owner: p0 } },
          market: ['BLUE', 'GREEN', 'YELLOW', 'BLACK', 'WHITE'],
        },
        {
          ...emptyEvents(),
          active: [activeEvent('STATION_FRONT_NIGHT_MARKET', { cityId: ownedRoute.a })],
        },
      ),
      p0,
      { hand: handOf({ RED: 1 }) },
    );
    const swap = reduce(base.board, state, {
      t: 'NIGHT_MARKET_SWAP',
      player: p0,
      giveColor: 'RED',
      slot: 0,
    });
    expect(swap.ok).toBe(true);
    if (!swap.ok) return;
    expect(swap.value.state.players.p0!.hand.RED).toBe(0);
    expect(swap.value.state.players.p0!.hand.BLUE).toBe(1);
    expect(swap.value.state.market[0]).toBe('RED');
    expect(swap.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(swap.value.state.turn.nightMarketSwapUsed).toBe(true);
    expect(
      reduce(base.board, swap.value.state, {
        t: 'NIGHT_MARKET_SWAP',
        player: p0,
        giveColor: 'BLUE',
        slot: 1,
      }).ok,
    ).toBe(false);
  });

  it('Goddess Procession moves each round, grants a blind card and blessing, and scores tied leaders', () => {
    const base = afterSetup(2, 'future-procession');
    const route = simpleRoutes(base.board)[0]!;
    const rest = base.board.cityIds
      .filter((city) => city !== route.a && city !== route.b)
      .slice(0, 3);
    const path = [route.a, route.b, ...rest];
    const event = activeEvent('GODDESS_PROCESSION', { cityPath: path, position: 0 });
    const state = stocked(withEvents(base.state, { ...emptyEvents(), active: [event] }));
    const cardsBefore = handTotal(state, p0);
    const claim = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: routePayment(route),
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(handTotal(claim.value.state, p0)).toBe(cardsBefore - route.length + 1);
    expect(claim.value.state.events!.resources.p0?.blessings).toBe(1);

    const moved = tickRound(
      base.board,
      withEvents(base.state, { ...emptyEvents(), roundIndex: 2, active: [event] }),
    );
    expect(moved.state.events!.active[0]?.position).toBe(1);
    expect(
      moved.events.some(
        (item) => item.e === 'EVENT_MARKER_MOVED' && item.kind === 'GODDESS_PROCESSION',
      ),
    ).toBe(true);

    const tied = withEvents(base.state, {
      ...emptyEvents(),
      resources: {
        p0: resources({ blessings: 2 }),
        p1: resources({ blessings: 2 }),
      },
    });
    const finals = computeFinalScores(base.board, tied);
    expect(finals.players.find((player) => player.playerId === p0)?.eventBonus).toBe(4);
    expect(finals.players.find((player) => player.playerId === p1)?.eventBonus).toBe(4);
  });

  it('Spring Festival Rush reverses traversal and expands ticket offers to four, keep one', () => {
    const three = afterSetup(3, 'future-spring-order');
    const spring = withEvents(three.state, {
      ...emptyEvents(),
      active: [activeEvent('SPRING_FESTIVAL_RUSH')],
    });
    const ended = endTurn(three.board, spring, { wasPass: false });
    expect(ended.state.turn.orderIndex).toBe(2);
    expect(currentPlayerId(ended.state)).toBe(p2);

    const two = afterSetup(2, 'future-spring-tickets');
    const offer = reduce(
      two.board,
      withEvents(two.state, {
        ...emptyEvents(),
        active: [activeEvent('SPRING_FESTIVAL_RUSH')],
      }),
      { t: 'DRAW_TICKETS', player: p0 },
    );
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    expect(offer.value.state.players.p0!.pendingTicketOffer).toHaveLength(4);
    const keepOne = reduce(two.board, offer.value.state, {
      t: 'KEEP_TICKETS',
      player: p0,
      keep: offer.value.state.players.p0!.pendingTicketOffer!.slice(0, 1),
    });
    expect(keepOne.ok).toBe(true);
  });

  it('Rolling-Stock Allocation Day drafts in reverse score order and grants all three perks', () => {
    const base = afterSetup(3, 'future-draft');
    let state = setPlayer(
      setPlayer(setPlayer(base.state, p0, { routePoints: 5 }), p1, {
        routePoints: 1,
      }),
      p2,
      { routePoints: 1 },
    );
    const entry: EventScheduleEntry = {
      id: 'draft',
      kind: 'ROLLING_STOCK_ALLOCATION_DAY',
      startRound: 2,
      durationRounds: 0,
      telegraphed: false,
    };
    state = withEvents(state, { ...emptyEvents(), roundIndex: 2, schedule: [entry] });
    const opened = tickRound(base.board, state).state;
    expect(opened.turn.phase).toBe('EVENT_DRAFT');
    expect(opened.events!.eventDraft?.order).toEqual([p2, p1, p0]);
    expect(currentPlayerId(opened)).toBe(p2);

    const cardsBefore = handTotal(opened, p2);
    const drawTwo = reduce(base.board, opened, {
      t: 'CHOOSE_EVENT_PERK',
      player: p2,
      perk: 'DRAW_TWO',
    });
    expect(drawTwo.ok).toBe(true);
    if (!drawTwo.ok) return;
    expect(handTotal(drawTwo.value.state, p2)).toBe(cardsBefore + 2);
    expect(currentPlayerId(drawTwo.value.state)).toBe(p1);

    const discount = reduce(base.board, drawTwo.value.state, {
      t: 'CHOOSE_EVENT_PERK',
      player: p1,
      perk: 'CLAIM_DISCOUNT',
    });
    expect(discount.ok).toBe(true);
    if (!discount.ok) return;
    expect(discount.value.state.events!.resources.p1?.claimDiscounts).toBe(1);

    const permit = reduce(base.board, discount.value.state, {
      t: 'CHOOSE_EVENT_PERK',
      player: p0,
      perk: 'REPAIR_PERMIT',
    });
    expect(permit.ok).toBe(true);
    if (!permit.ok) return;
    expect(permit.value.state.events!.resources.p0?.repairPermits).toBe(1);
    expect(permit.value.state.events!.eventDraft).toBeUndefined();
    expect(permit.value.state.turn.phase).toBe('AWAIT_ACTION');
    expect(currentPlayerId(permit.value.state)).toBe(p0);
  });

  it('resumes the allocation draft into the existing forced-ticket rule when objectives are done', () => {
    const base = afterSetup(2, 'future-draft-forced-ticket');
    const self = base.state.players.p0!;
    const state = setPlayer(
      withEvents(
        {
          ...base.state,
          turn: { orderIndex: 0, phase: 'EVENT_DRAFT', cardsDrawnThisTurn: 0 },
        },
        {
          ...emptyEvents(),
          eventDraft: {
            eventId: 'draft',
            order: [p0],
            pickIndex: 0,
            resumeOrderIndex: 0,
            picks: [],
          },
        },
      ),
      p0,
      { completedTickets: [...self.keptTickets] },
    );
    const pick = reduce(base.board, state, {
      t: 'CHOOSE_EVENT_PERK',
      player: p0,
      perk: 'CLAIM_DISCOUNT',
    });
    expect(pick.ok).toBe(true);
    if (!pick.ok) return;
    expect(pick.value.state.turn.phase).toBe('TICKET_SELECTION');
    expect(pick.value.state.players.p0!.pendingTicketOffer).not.toBeNull();
    expect(pick.value.events.some((event) => event.e === 'TICKETS_OFFERED')).toBe(true);
  });

  it('Hive of Sparks keeps stopped cards, but consecutive equal colours bust back to the first', () => {
    const base = afterSetup(2, 'future-hive');
    const live = (deck: CardColor[]) =>
      withEvents(
        { ...base.state, deck },
        { ...emptyEvents(), active: [activeEvent('HIVE_OF_SPARKS')] },
      );

    const safeState = live(['GREEN', 'BLUE', 'RED']);
    const safeBefore = handTotal(safeState, p0);
    const start = reduce(base.board, safeState, { t: 'START_HIVE_DRAW', player: p0 });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const continued = reduce(base.board, start.value.state, {
      t: 'CONTINUE_HIVE_DRAW',
      player: p0,
    });
    expect(continued.ok).toBe(true);
    if (!continued.ok) return;
    const stopped = reduce(base.board, continued.value.state, {
      t: 'STOP_HIVE_DRAW',
      player: p0,
    });
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    expect(handTotal(stopped.value.state, p0)).toBe(safeBefore + 2);

    const bustState = live(['GREEN', 'RED', 'RED']);
    const bustBefore = handTotal(bustState, p0);
    const discardBefore = bustState.discard.RED;
    const bustStart = reduce(base.board, bustState, { t: 'START_HIVE_DRAW', player: p0 });
    expect(bustStart.ok).toBe(true);
    if (!bustStart.ok) return;
    const bust = reduce(base.board, bustStart.value.state, {
      t: 'CONTINUE_HIVE_DRAW',
      player: p0,
    });
    expect(bust.ok).toBe(true);
    if (!bust.ok) return;
    expect(handTotal(bust.value.state, p0)).toBe(bustBefore + 1);
    expect(bust.value.state.discard.RED).toBe(discardBefore + 1);
    expect(
      bust.value.events.some(
        (event) => event.e === 'EVENT_HIVE_RESOLVED' && event.busted && event.keptCount === 1,
      ),
    ).toBe(true);
  });

  it('Breakthrough Boring Machine buries a bottom-third marker and tunnels reveal two until it surfaces', () => {
    const base = afterSetup(2, 'future-boring');
    const startEntry: EventScheduleEntry = {
      id: 'boring',
      kind: 'BREAKTHROUGH_BORING_MACHINE',
      startRound: 2,
      durationRounds: 0,
      telegraphed: false,
      markerSelector: 2,
    };
    const started = tickRound(
      base.board,
      withEvents(
        { ...base.state, deck: base.state.deck.slice(0, 9) },
        { ...emptyEvents(), roundIndex: 2, schedule: [startEntry] },
      ),
    ).state;
    expect(started.events!.boringMachine?.remainingDraws).toBeGreaterThanOrEqual(7);
    expect(started.events!.boringMachine?.remainingDraws).toBeLessThanOrEqual(9);

    const tunnel = base.board.content.routes.find(
      (route) => route.isTunnel && route.ferryLocos < route.length,
    )!;
    const markerState = stocked(
      withEvents(
        { ...base.state, deck: ['BLUE', 'GREEN', 'YELLOW'] },
        { ...emptyEvents(), boringMachine: { eventId: 'boring', remainingDraws: 1 } },
      ),
    );
    expect(effectiveTunnelRevealCount(markerState)).toBe(2);
    const claim = reduce(base.board, markerState, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: routePayment(tunnel),
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.state.pendingTunnel?.revealed).toHaveLength(2);
    expect(claim.value.state.events!.boringMachine).toBeUndefined();
    expect(
      claim.value.events.some(
        (event) => event.e === 'EVENT_ENDED' && event.kind === 'BREAKTHROUGH_BORING_MACHINE',
      ),
    ).toBe(true);
  });

  it('Interim Operations Report scores one per three routes plus every nonzero longest leader', () => {
    const base = afterSetup(2, 'future-interim');
    const owned = Object.fromEntries(
      base.board.content.routes.slice(0, 3).map((route) => [route.id as string, { owner: p0 }]),
    );
    const entry: EventScheduleEntry = {
      id: 'interim',
      kind: 'INTERIM_OPERATIONS_REPORT',
      startRound: 2,
      durationRounds: 0,
      telegraphed: false,
    };
    const pulse = tickRound(
      base.board,
      withEvents(
        { ...base.state, ownership: owned },
        { ...emptyEvents(), roundIndex: 2, schedule: [entry] },
      ),
    );
    expect(pulse.state.players.p0!.routePoints).toBe(4);
    expect(pulse.state.players.p1!.routePoints).toBe(0);
    expect(
      pulse.events.filter((event) => event.e === 'EVENT_BONUS').map((event) => event.reason),
    ).toEqual(['INTERIM_ROUTES', 'INTERIM_TRAIL']);
  });

  it('Harvest Festival Express gives region claims +1 and recycles any face-up colour triple', () => {
    const base = afterSetup(2, 'future-harvest');
    const route = simpleRoutes(base.board).find(
      (item) => base.board.cityById.get(item.a as string)?.region !== undefined,
    )!;
    const region = base.board.cityById.get(route.a as string)!.region!;
    const active = activeEvent('HARVEST_FESTIVAL_EXPRESS', { region });
    const claimState = stocked(withEvents(base.state, { ...emptyEvents(), active: [active] }));
    const before = claimState.players.p0!.routePoints;
    const claim = reduce(base.board, claimState, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: routePayment(route),
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.state.players.p0!.routePoints).toBe(
      before + (claimState.ruleParams.routePoints[route.length] ?? 0) + 1,
    );

    const recycleState = withEvents(
      {
        ...base.state,
        market: ['RED', 'RED', 'BLUE', 'GREEN', 'YELLOW'],
        deck: ['BLACK', 'WHITE', 'PURPLE', 'GREEN', 'YELLOW', 'RED'],
        discard: handOf({}),
      },
      { ...emptyEvents(), active: [active] },
    );
    const draw = reduce(base.board, recycleState, { t: 'DRAW_FACEUP', player: p0, slot: 2 });
    expect(draw.ok).toBe(true);
    if (!draw.ok) return;
    expect(
      draw.value.events.some(
        (event) => event.e === 'MARKET_RECYCLED' && event.reason === 'THREE_OF_COLOR',
      ),
    ).toBe(true);
  });

  it('All Seats Reserved blocks face-up locomotives and rewards only extra locomotives in base claims', () => {
    const base = afterSetup(2, 'future-reserved');
    const active = activeEvent('ALL_SEATS_RESERVED');
    const blockedState = withEvents(
      { ...base.state, market: ['LOCOMOTIVE', 'RED', 'BLUE', 'GREEN', 'YELLOW'] },
      { ...emptyEvents(), active: [active] },
    );
    const blocked = reduce(base.board, blockedState, { t: 'DRAW_FACEUP', player: p0, slot: 0 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('EVENT_FACEUP_LOCO_BLOCKED');

    const networkRoute = simpleRoutes(base.board)[0]!;
    const nightReserved = setPlayer(
      withEvents(
        {
          ...base.state,
          ownership: { [networkRoute.id as string]: { owner: p0 } },
          market: ['LOCOMOTIVE', 'RED', 'BLUE', 'GREEN', 'YELLOW'],
        },
        {
          ...emptyEvents(),
          active: [active, activeEvent('STATION_FRONT_NIGHT_MARKET', { cityId: networkRoute.a })],
        },
      ),
      p0,
      { hand: handOf({ RED: 1 }) },
    );
    const nightBlocked = reduce(base.board, nightReserved, {
      t: 'NIGHT_MARKET_SWAP',
      player: p0,
      giveColor: 'RED',
      slot: 0,
    });
    expect(nightBlocked.ok).toBe(false);
    if (!nightBlocked.ok) expect(nightBlocked.error.code).toBe('EVENT_FACEUP_LOCO_BLOCKED');

    const route = simpleRoutes(base.board).find((item) => item.length >= 2)!;
    const claimState = stocked(withEvents(base.state, { ...emptyEvents(), active: [active] }));
    const bonus = reduce(base.board, claimState, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: routePayment(route, 1),
    });
    expect(bonus.ok).toBe(true);
    if (!bonus.ok) return;
    expect(
      bonus.value.events.some(
        (event) =>
          event.e === 'EVENT_BONUS' && event.kind === 'ALL_SEATS_RESERVED' && event.points === 2,
      ),
    ).toBe(true);

    const tunnel = base.board.content.routes.find(
      (item) => item.isTunnel && item.ferryLocos < item.length,
    )!;
    const played = tunnel.color === 'GRAY' ? 'RED' : tunnel.color;
    const other = TRAIN_COLORS.filter((color) => color !== played).slice(0, 2);
    const tunnelState = stocked(
      withEvents(
        { ...base.state, deck: [other[0]!, other[1]!, 'LOCOMOTIVE'] },
        { ...emptyEvents(), active: [active] },
      ),
    );
    const begin = reduce(base.board, tunnelState, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: tunnel.id,
      payment: routePayment(tunnel),
    });
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.value.state.pendingTunnel?.extraRequired).toBe(1);
    const commit = reduce(base.board, begin.value.state, {
      t: 'RESOLVE_TUNNEL',
      player: p0,
      commit: true,
      extra: { color: null, colorCount: 0, locomotives: 1 },
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(
      commit.value.events.some(
        (event) => event.e === 'EVENT_BONUS' && event.kind === 'ALL_SEATS_RESERVED',
      ),
    ).toBe(false);
  });

  it('Lucky Ticket Stub permanently awards the first own-network connector +5', () => {
    const base = afterSetup(2, 'future-lucky');
    const route = simpleRoutes(base.board)[0]!;
    const state = stocked(
      withEvents(base.state, {
        ...emptyEvents(),
        luckyContracts: [{ id: 'lucky', a: route.a, b: route.b, points: 5, wonBy: null }],
      }),
    );
    const before = state.players.p0!.routePoints;
    const claim = reduce(base.board, state, {
      t: 'CLAIM_ROUTE',
      player: p0,
      routeId: route.id,
      payment: routePayment(route),
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.state.events!.luckyContracts[0]?.wonBy).toBe(p0);
    expect(claim.value.state.players.p0!.routePoints).toBe(
      before + (state.ruleParams.routePoints[route.length] ?? 0) + 5,
    );
  });

  it('preserves END-pass state when a card-drawing event starts on the same round boundary', () => {
    const base = afterSetup(2, 'future-runtime-sync');
    const route = simpleRoutes(base.board)[0]!;
    const gala: EventScheduleEntry = {
      id: 'gala',
      kind: 'RAILWAY_GALA',
      startRound: 2,
      durationRounds: 1,
      telegraphed: false,
    };
    const state = withEvents(base.state, {
      ...emptyEvents(),
      roundIndex: 2,
      schedule: [gala],
      active: [
        activeEvent('TYPHOON_LANDFALL', {
          id: 'storm',
          endsAfterRound: 1,
          routeIds: [route.id],
        }),
      ],
    });
    const tick = tickRound(base.board, state);
    expect(tick.state.events!.reopenBonus).toContain(route.id);
    expect(tick.state.events!.active.some((item) => item.id === 'storm')).toBe(false);
    expect(tick.state.events!.freeStation).toEqual({ untilRound: 2 });
  });

  it('exposes reducer-accepted mandatory actions through legalActions in every new phase', () => {
    const base = afterSetup(2, 'future-legal-phases');
    const city = base.board.cityIds[0]!;
    const lantern = withEvents(
      {
        ...base.state,
        turn: { orderIndex: 0, phase: 'LANTERN_RELOCATION', cardsDrawnThisTurn: 0 },
      },
      {
        ...emptyEvents(),
        lanternHost: { eventId: 'lantern', cityId: city, points: 6 },
        lanternPendingRelocation: { playerId: p0, candidateCityIds: [base.board.cityIds[1]!] },
      },
    );
    expect(legalActions(base.board, lantern, p0).map((action) => action.t)).toEqual([
      'RELOCATE_LANTERN_HOST',
    ]);

    const draft = withEvents(
      { ...base.state, turn: { orderIndex: 0, phase: 'EVENT_DRAFT', cardsDrawnThisTurn: 0 } },
      {
        ...emptyEvents(),
        eventDraft: {
          eventId: 'draft',
          order: [p0, p1],
          pickIndex: 0,
          resumeOrderIndex: 0,
          picks: [],
        },
      },
    );
    expect(legalActions(base.board, draft, p0)).toHaveLength(3);

    const hive = withEvents(
      { ...base.state, turn: { orderIndex: 0, phase: 'HIVE_DRAW', cardsDrawnThisTurn: 0 } },
      {
        ...emptyEvents(),
        pendingHiveDraw: { playerId: p0, revealed: ['RED'], maxDraws: 4 },
      },
    );
    expect(
      legalActions(base.board, hive, p0)
        .map((action) => action.t)
        .sort(),
    ).toEqual(['CONTINUE_HIVE_DRAW', 'STOP_HIVE_DRAW']);
  });

  it('keeps PASS illegal when only a partially-reduced ferry payment is affordable', () => {
    const base = afterSetup(2, 'future-ferry-reduction');
    // A ferry one card longer than its locomotive minimum: the full bento+discount reduction
    // (−2) would drop the card requirement below the ferry floor, but spending only the bento
    // as a one-card wild (−1) leaves a legal all-locomotive payment.
    const ferry = base.board.content.routes.find(
      (route) =>
        !route.isTunnel &&
        route.doubleGroup === undefined &&
        route.ferryLocos === 1 &&
        route.length === 2,
    )!;
    // Strip every other option: all other routes taken, draw piles/market/tickets empty, no
    // stations left — the ferry claim is the sole legal move.
    const ownership = Object.fromEntries(
      base.board.content.routes
        .filter((route) => route.id !== ferry.id)
        .map((route) => [route.id as string, { owner: p1 }]),
    );
    const state = setPlayer(
      withEvents(
        {
          ...base.state,
          ownership,
          deck: [],
          discard: handOf({}),
          market: [null, null, null, null, null],
          ticketDeckShort: [],
        },
        {
          ...emptyEvents(),
          resources: { p0: resources({ bentoTokens: 1, claimDiscounts: 1 }) },
        },
      ),
      p0,
      { hand: handOf({ LOCOMOTIVE: 1 }), trainCars: 45, stationsRemaining: 0 },
    );

    expect(hasAnyLegalMove(base.board, state, p0)).toBe(true);
    const legal = legalActions(base.board, state, p0);
    expect(legal.some((action) => action.t === 'CLAIM_ROUTE')).toBe(true);
    expect(legal.some((action) => action.t === 'PASS')).toBe(false);
  });
});
