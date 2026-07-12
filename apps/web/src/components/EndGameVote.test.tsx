import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../i18n';
import i18n from '../i18n';
import type { RoomMember } from '../net/rest';
import { EndGameVote } from './EndGameVote';

const member = (over: Partial<RoomMember>): RoomMember => ({
  userId: 'p0',
  displayName: 'Player',
  isGuest: false,
  seat: 0,
  ready: true,
  ...over,
});

describe('EndGameVote', () => {
  beforeEach(() => void i18n.changeLanguage('en'));
  afterEach(() => void i18n.changeLanguage('zh-Hant'));

  it('shows the human-player-minus-one threshold and confirms before voting', () => {
    const onVote = vi.fn();
    render(
      <EndGameVote
        members={[
          member({ userId: 'p0' }),
          member({ userId: 'p1', seat: 1, wantsEnd: true }),
          member({ userId: 'p2', seat: 2 }),
          member({ userId: 'bot:1', seat: 3, isBot: true, wantsEnd: true }),
        ]}
        playerId="p0"
        isHost={false}
        onVote={onVote}
      />,
    );

    expect(screen.getByText('End votes: 1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vote to end game' }));
    expect(onVote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm vote' }));
    expect(onVote).toHaveBeenCalledWith(true);
  });

  it('withdraws an existing non-owner vote without a destructive confirmation', () => {
    const onVote = vi.fn();
    render(
      <EndGameVote
        members={[member({ userId: 'p0', wantsEnd: true }), member({ userId: 'p1', seat: 1 })]}
        playerId="p0"
        isHost={false}
        onVote={onVote}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw end vote' }));
    expect(onVote).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains that the room owner can end immediately', () => {
    const onVote = vi.fn();
    render(
      <EndGameVote
        members={[member({ userId: 'p0' }), member({ userId: 'p1', seat: 1 })]}
        playerId="p0"
        isHost
        onVote={onVote}
      />,
    );

    expect(screen.getByText(/As room owner/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End game now' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('button.danger')!);
    expect(onVote).toHaveBeenCalledWith(true);
  });
});
