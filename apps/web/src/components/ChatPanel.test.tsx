import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { GameSnapshotSchema, Phase } from '@trm/proto';
import '../i18n';
import { ChatPanel } from './ChatPanel';
import { useChat } from '../store/chat';
import { useGame } from '../store/game';

const chatSpy = vi.fn();
const chatPresetSpy = vi.fn();
vi.mock('../net/connection', () => ({
  getSocket: () => ({ chat: chatSpy, chatPreset: chatPresetSpy }),
}));

beforeEach(() => {
  chatSpy.mockClear();
  chatPresetSpy.mockClear();
  useChat.getState().reset();
  useGame.setState({
    snapshot: create(GameSnapshotSchema, {
      stateVersion: 1,
      phase: Phase.AWAIT_ACTION,
      currentPlayerId: 'p1',
      turnOrder: ['p1'],
      players: [{ id: 'p1', seat: 0, trainCars: 45, stationsRemaining: 3 }],
      you: { playerId: 'p1', hand: {}, keptTicketIds: [], pendingOfferTicketIds: [] },
    }),
    rejection: null,
  });
});

describe('ChatPanel', () => {
  it('sends a trimmed message and clears the input', () => {
    render(<ChatPanel />);
    fireEvent.change(screen.getByPlaceholderText('輸入訊息…'), { target: { value: '  hello  ' } });
    fireEvent.click(screen.getByRole('button', { name: '傳送' }));
    expect(chatSpy).toHaveBeenCalledWith('hello');
    expect((screen.getByPlaceholderText('輸入訊息…') as HTMLInputElement).value).toBe('');
  });

  it('renders received free-text messages', () => {
    useChat.getState().ingest({ playerId: 'p1', content: { case: 'text', value: 'gg' } });
    render(<ChatPanel />);
    expect(screen.getByText('gg')).toBeInTheDocument();
  });

  it('renders a received preset message translated, not by its raw id', () => {
    useChat
      .getState()
      .ingest({ playerId: 'p1', content: { case: 'presetId', value: 'GOOD_LUCK' } });
    const { container } = render(<ChatPanel />);
    const msg = container.querySelector('.chat-msg .chat-text');
    expect(msg?.textContent).toBe('祝你好運，玩得開心！');
    expect(screen.queryByText('GOOD_LUCK')).not.toBeInTheDocument();
  });

  it('sends a preset message when a preset button is clicked', () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: '謝謝！' }));
    expect(chatPresetSpy).toHaveBeenCalledWith('THANKS');
  });

  it('disables the input and preset buttons for spectators', () => {
    render(<ChatPanel disabled />);
    expect(screen.getByRole('button', { name: '傳送' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '謝謝！' })).toBeDisabled();
  });

  it('shows an inline hint for a server chat rejection', () => {
    useGame.setState({ rejection: { code: 5, messageKey: 'errors:chatRateLimited' } });
    render(<ChatPanel />);
    expect(screen.getByText('傳送太快，請稍候…')).toBeInTheDocument();
  });
});
