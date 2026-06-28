import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { TICKETS } from '../game/content';
import { TicketPanel } from './TicketPanel';

const A = TICKETS[0]!.id as string;
const B = TICKETS[1]!.id as string;
const C = TICKETS[2]!.id as string;

describe('TicketPanel', () => {
  it('marks completed missions and renders the rest plainly', () => {
    const { container } = render(<TicketPanel ticketIds={[A, B]} completedIds={new Set([A])} />);
    const cards = container.querySelectorAll('.ticket-card');
    expect(cards.length).toBe(2);
    expect(container.querySelectorAll('.ticket-card.is-completed').length).toBe(1);
    expect(container.querySelectorAll('.ticket-done').length).toBe(1);
  });

  it('sinks completed missions to the bottom while keeping the order of the rest', () => {
    // A completed, B & C open — completed A should end up last.
    const { container } = render(
      <TicketPanel ticketIds={[A, B, C]} completedIds={new Set([A])} />,
    );
    const cards = [...container.querySelectorAll('.ticket-card')];
    expect(cards[0]!.classList.contains('is-completed')).toBe(false);
    expect(cards[1]!.classList.contains('is-completed')).toBe(false);
    expect(cards[2]!.classList.contains('is-completed')).toBe(true);
  });

  it('shows the empty state with no tickets', () => {
    const { container } = render(<TicketPanel ticketIds={[]} />);
    expect(container.querySelector('.muted')).toBeTruthy();
    expect(container.querySelector('.ticket-card')).toBeNull();
  });
});
