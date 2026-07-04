import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { create } from '@bufbuild/protobuf';
import { CardColor, GameSnapshotSchema, CardCountsSchema, Phase } from '@trm/proto';
import { CardMarket } from './CardMarket';

function snap(opts: {
  deckCount: number;
  discard?: Partial<{ red: number; locomotive: number }>;
  phase?: Phase;
  market?: CardColor[];
}) {
  return create(GameSnapshotSchema, {
    stateVersion: 1,
    deckCount: opts.deckCount,
    discard: create(CardCountsSchema, opts.discard ?? {}),
    phase: opts.phase ?? Phase.AWAIT_ACTION,
    market: opts.market ?? [
      CardColor.GREEN,
      CardColor.YELLOW,
      CardColor.BLACK,
      CardColor.WHITE,
      CardColor.ORANGE,
    ],
  });
}

const deckButton = (c: HTMLElement) => c.querySelector('button.deck') as HTMLButtonElement;
const slotButtons = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('button.market-slot')) as HTMLButtonElement[];

describe('CardMarket — blind deck draw availability', () => {
  it('keeps the blind deck drawable when the deck is empty but the discard has cards', () => {
    // The engine reshuffles the discard into the deck on a blind draw, so this IS a legal move.
    const { container } = render(
      <CardMarket
        snapshot={snap({ deckCount: 0, discard: { red: 5 } })}
        canDraw
        onDrawFaceUp={vi.fn()}
        onDrawBlind={vi.fn()}
      />,
    );
    expect(deckButton(container).disabled).toBe(false);
  });

  it('disables the blind deck on the FIRST draw when both deck and discard are empty', () => {
    const { container } = render(
      <CardMarket
        snapshot={snap({ deckCount: 0, phase: Phase.AWAIT_ACTION })}
        canDraw
        onDrawFaceUp={vi.fn()}
        onDrawBlind={vi.fn()}
      />,
    );
    expect(deckButton(container).disabled).toBe(true);
  });

  it("disables the blind deck when it is not the player's draw step", () => {
    const { container } = render(
      <CardMarket
        snapshot={snap({ deckCount: 5, discard: { red: 5 } })}
        canDraw={false}
        onDrawFaceUp={vi.fn()}
        onDrawBlind={vi.fn()}
      />,
    );
    expect(deckButton(container).disabled).toBe(true);
  });

  it('disables a face-up Locomotive slot as a second draw', () => {
    const { container } = render(
      <CardMarket
        snapshot={snap({
          deckCount: 5,
          phase: Phase.DRAWING_CARDS,
          market: [
            CardColor.LOCOMOTIVE,
            CardColor.YELLOW,
            CardColor.BLACK,
            CardColor.WHITE,
            CardColor.ORANGE,
          ],
        })}
        canDraw
        onDrawFaceUp={vi.fn()}
        onDrawBlind={vi.fn()}
      />,
    );
    const buttons = slotButtons(container);
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
  });
});
