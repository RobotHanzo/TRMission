import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { SECRET_CLASS } from '../observability/secrets';
import { useAnimations } from '../store/animations';
import { AnimationLayer } from './AnimationLayer';

/** Flights are dropped when an end can't be measured, so both anchors must exist in the document. */
const mountAnchors = (): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML =
    '<div data-anim="deck"></div><div data-anim="market-slot" data-slot="1"></div>' +
    '<div data-player-id="p0"></div><div data-player-id="p1"></div>';
  document.body.append(host);
  return host;
};

describe('AnimationLayer card flights', () => {
  let anchors: HTMLElement;

  beforeEach(() => {
    useAnimations.getState().reset();
    anchors = mountAnchors();
  });
  afterEach(() => anchors.remove());

  it('blocks a face-down draw of the viewer’s own card from Session Replay', () => {
    // cardDrawnBlind for the viewer: face-down flight that still carries the real colour.
    useAnimations.getState().pushIntent({
      kind: 'cardFly',
      from: { at: 'deck' },
      to: { at: 'player', playerId: 'p0' },
      faceUp: false,
      color: 'RED',
    });
    render(<AnimationLayer />);
    const card = document.querySelector('.flying-card');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('is-face');
    expect(card).toHaveClass(SECRET_CLASS);
  });

  it('leaves a public face-up flight recordable', () => {
    // cardTakenFaceup: everyone at the table saw this card in the market slot.
    useAnimations.getState().pushIntent({
      kind: 'cardFly',
      from: { at: 'market', slot: 1 },
      to: { at: 'player', playerId: 'p0' },
      faceUp: true,
      color: 'RED',
    });
    render(<AnimationLayer />);
    const card = document.querySelector('.flying-card');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('is-face');
    expect(card).not.toHaveClass(SECRET_CLASS);
  });

  it('leaves an opponent’s faceless draw recordable', () => {
    useAnimations.getState().pushIntent({
      kind: 'cardFly',
      from: { at: 'deck' },
      to: { at: 'player', playerId: 'p1' },
      faceUp: false,
      color: null,
    });
    render(<AnimationLayer />);
    const card = document.querySelector('.flying-card');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('is-cover');
    expect(card).not.toHaveClass(SECRET_CLASS);
  });
});
