import { render, fireEvent, act } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { CardColor as PbCardColor, CardCountsSchema, GameSnapshotSchema, Phase } from '@trm/proto';
import { useUi } from '../../../store/ui';
import { PlayerHand } from '../PlayerHand';
import { CardMarket } from '../CardMarket';
import { PlayerTrackers } from '../PlayerTrackers';

const marketSnapshot = (overrides: Record<string, unknown> = {}) =>
  create(GameSnapshotSchema, {
    market: [
      PbCardColor.RED,
      PbCardColor.BLUE,
      PbCardColor.GREEN,
      PbCardColor.LOCOMOTIVE,
      PbCardColor.WHITE,
    ],
    deckCount: 40,
    phase: Phase.AWAIT_ACTION,
    players: [],
    ...overrides,
  });

afterEach(() => {
  act(() => {
    useUi.setState({ colorBlind: false });
  });
});

describe('PlayerHand', () => {
  const hand = create(CardCountsSchema, { red: 3, locomotive: 1 });

  it('renders one card per held colour with its count', () => {
    const { getByText, queryByText } = render(<PlayerHand hand={hand} />);
    expect(getByText('×3')).toBeTruthy();
    expect(getByText('×1')).toBeTruthy();
    // No glyph chips while colour-blind mode is off.
    expect(queryByText('▲')).toBeNull();
  });

  it('shows the colour-blind glyphs only when the setting is on', () => {
    act(() => {
      useUi.setState({ colorBlind: true });
    });
    const { getByText } = render(<PlayerHand hand={hand} />);
    expect(getByText('▲')).toBeTruthy(); // RED
    expect(getByText('★')).toBeTruthy(); // LOCOMOTIVE
  });

  it('renders the empty-hand hint when nothing is held', () => {
    const { getByText } = render(<PlayerHand hand={undefined} />);
    expect(getByText('沒有手牌')).toBeTruthy(); // zh-Hant is the primary locale
  });
});

describe('CardMarket', () => {
  it('pressing a face-up slot draws it', () => {
    const onDrawFaceUp = jest.fn();
    const { getByTestId } = render(
      <CardMarket
        snapshot={marketSnapshot()}
        canDraw
        onDrawFaceUp={onDrawFaceUp}
        onDrawBlind={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('market-slot-2'));
    expect(onDrawFaceUp).toHaveBeenCalledWith(2);
  });

  it('ignores presses when the viewer cannot draw', () => {
    const onDrawFaceUp = jest.fn();
    const onDrawBlind = jest.fn();
    const { getByTestId } = render(
      <CardMarket
        snapshot={marketSnapshot()}
        canDraw={false}
        onDrawFaceUp={onDrawFaceUp}
        onDrawBlind={onDrawBlind}
      />,
    );
    fireEvent.press(getByTestId('market-slot-2'));
    fireEvent.press(getByTestId('market-deck'));
    expect(onDrawFaceUp).not.toHaveBeenCalled();
    expect(onDrawBlind).not.toHaveBeenCalled();
  });

  it('blocks a face-up locomotive as the second draw (engine rule)', () => {
    const onDrawFaceUp = jest.fn();
    const { getByTestId } = render(
      <CardMarket
        snapshot={marketSnapshot({ phase: Phase.DRAWING_CARDS })}
        canDraw
        onDrawFaceUp={onDrawFaceUp}
        onDrawBlind={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId('market-slot-3')); // the LOCOMOTIVE slot
    expect(onDrawFaceUp).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('market-slot-0'));
    expect(onDrawFaceUp).toHaveBeenCalledWith(0);
  });

  it('draws blind from the deck', () => {
    const onDrawBlind = jest.fn();
    const { getByTestId } = render(
      <CardMarket
        snapshot={marketSnapshot()}
        canDraw
        onDrawFaceUp={jest.fn()}
        onDrawBlind={onDrawBlind}
      />,
    );
    fireEvent.press(getByTestId('market-deck'));
    expect(onDrawBlind).toHaveBeenCalled();
  });
});

describe('PlayerTrackers', () => {
  const snapshot = create(GameSnapshotSchema, {
    currentPlayerId: 'bot:1',
    players: [
      { id: 'p1', seat: 0, trainCars: 45, handCount: 4, ticketCount: 3, stationsRemaining: 3 },
      { id: 'bot:1', seat: 1, trainCars: 40, handCount: 6, ticketCount: 2, stationsRemaining: 2 },
    ],
  });

  it('marks the bot row with a badge and the current player with the turn ring', () => {
    const { getByTestId, queryByTestId } = render(<PlayerTrackers snapshot={snapshot} />);
    expect(getByTestId('bot-badge-bot:1')).toBeTruthy();
    expect(queryByTestId('bot-badge-p1')).toBeNull();
    expect(getByTestId('tracker-bot:1').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(getByTestId('tracker-p1').props.accessibilityState).toMatchObject({ selected: false });
  });
});
