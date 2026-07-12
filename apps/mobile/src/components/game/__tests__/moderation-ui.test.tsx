// Block/report UI contracts (Apple 1.2 / Play UGC): chat filtering, name masking,
// and the report sheet's exact submit payload.
import { act, fireEvent, render } from '@testing-library/react-native';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema } from '@trm/proto';
import '../../../i18n'; // initialise the singleton so t() resolves zh-Hant strings
import { api } from '../../../net/rest';
import { useChat } from '../../../store/chat';
import { useGame } from '../../../store/game';
import { useModeration } from '../../../store/moderation';
import { useRoster } from '../../../store/roster';
import { setActiveRoomContext } from '../../../game/activeRoom';
import { ChatPanel } from '../ChatPanel';
import { PlayerTrackers } from '../PlayerTrackers';
import { PlayerActionSheet, canModerate } from '../PlayerActionSheet';

jest.mock('../../../net/connection', () => ({ getSocket: jest.fn(() => null) }));
jest.mock('../../../net/rest', () => ({
  api: {
    myBlocks: jest.fn(),
    blockUser: jest.fn(),
    unblockUser: jest.fn(),
    reportPlayer: jest.fn(),
  },
}));

const mocked = api as unknown as {
  blockUser: jest.Mock;
  reportPlayer: jest.Mock;
};

const snapshot = create(GameSnapshotSchema, {
  players: [
    { id: 'me', seat: 0 },
    { id: 'u-loud', seat: 1 },
    { id: 'bot:easy-1', seat: 2 },
  ],
  you: { playerId: 'me' },
});

beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    useModeration.getState().reset();
    useChat.getState().reset();
    useGame.setState({ snapshot });
    useRoster.getState().clear();
  });
  setActiveRoomContext({});
});

describe('canModerate', () => {
  it('is false for yourself and for bots, true for other humans', () => {
    expect(canModerate('me', 'me')).toBe(false);
    expect(canModerate('bot:easy-1', 'me')).toBe(false);
    expect(canModerate('u-loud', 'me')).toBe(true);
  });
});

describe('ChatPanel blocked filtering', () => {
  it('hides messages (text and preset) from blocked authors', () => {
    act(() => {
      useChat.getState().ingest({ playerId: 'me', content: { case: 'text', value: 'hello' } });
      useChat
        .getState()
        .ingest({ playerId: 'u-loud', content: { case: 'text', value: 'rude words' } });
      useChat
        .getState()
        .ingest({ playerId: 'u-loud', content: { case: 'presetId', value: 'GREETING' } });
      useModeration.setState({ blocked: new Set(['u-loud']) });
    });
    const { queryByText, getByText, getAllByText } = render(<ChatPanel />);
    expect(getByText('hello')).toBeTruthy();
    expect(queryByText('rude words')).toBeNull();
    // The blocked author's GREETING preset must not render as a message — the single
    // remaining '哈囉！' is the always-present preset SEND chip, not a chat entry.
    expect(getAllByText('哈囉！')).toHaveLength(1);
  });
});

describe('PlayerTrackers name masking', () => {
  it('masks a blocked player back to the neutral seat label', () => {
    act(() => {
      useRoster
        .getState()
        .setMembers([
          { userId: 'u-loud', displayName: 'RudeName', isGuest: false, seat: 1, ready: true },
        ]);
      useModeration.setState({ blocked: new Set(['u-loud']) });
    });
    const { getByText, queryByText } = render(<PlayerTrackers snapshot={snapshot} />);
    expect(queryByText('RudeName')).toBeNull();
    expect(getByText('P2')).toBeTruthy();
  });
});

describe('PlayerActionSheet', () => {
  it('submits a report with the selected category, message, and active room context', async () => {
    mocked.reportPlayer.mockResolvedValue({ id: 'r1' });
    setActiveRoomContext({ gameId: 'g1', roomCode: 'ABCD' });
    const { getByTestId, findByText, getByText } = render(
      <PlayerActionSheet target={{ id: 'u-loud', name: 'Loud' }} onClose={jest.fn()} />,
    );
    fireEvent.press(getByTestId('sheet-report'));
    fireEvent.press(getByTestId('report-category-SPAM'));
    fireEvent.changeText(getByTestId('report-message'), 'spamming presets');
    fireEvent.press(getByText('送出檢舉'));
    expect(await findByText('已收到你的檢舉，我們會盡快處理。')).toBeTruthy();
    expect(mocked.reportPlayer).toHaveBeenCalledWith({
      userId: 'u-loud',
      category: 'SPAM',
      message: 'spamming presets',
      gameId: 'g1',
      roomCode: 'ABCD',
    });
  });

  it('block action calls the moderation store optimistically and closes', () => {
    mocked.blockUser.mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { getByTestId } = render(
      <PlayerActionSheet target={{ id: 'u-loud', name: 'Loud' }} onClose={onClose} />,
    );
    fireEvent.press(getByTestId('sheet-block'));
    expect(useModeration.getState().blocked.has('u-loud')).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});
