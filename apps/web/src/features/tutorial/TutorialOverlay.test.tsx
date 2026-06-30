import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TutorialOverlay } from './TutorialOverlay';
import type { Beat } from './types';

const baseProps = {
  done: false,
  index: 1,
  total: 4,
  lessonTitleKey: 'tutorial.draw.title',
  lessonNo: 2,
  lessonCount: 6,
  isLastLesson: false,
  onAdvance: () => {},
  onReplay: () => {},
  onPrevLesson: () => {},
  onNextLesson: () => {},
  onExit: () => {},
};

describe('TutorialOverlay', () => {
  it('renders the beat specimen when one is provided', () => {
    const beat: Beat = { id: 'b', text: 'tutorial.draw.intro', mode: 'info' };
    const { container } = render(
      <TutorialOverlay {...baseProps} beat={beat} specimen={{ kind: 'card-row' }} spotRects={[]} />,
    );
    expect(container.querySelector('[data-testid="tut-specimen"]')).toBeTruthy();
    expect(container.querySelectorAll('.train-card').length).toBe(9);
  });

  it('shows a progress bar reflecting index/total', () => {
    const beat: Beat = { id: 'b', text: 'tutorial.draw.intro', mode: 'info' };
    const { container } = render(<TutorialOverlay {...baseProps} beat={beat} spotRects={[]} />);
    const fill = container.querySelector<HTMLElement>('.tut-progress-fill');
    expect(fill).toBeTruthy();
    expect(fill!.style.width).toBe('50%'); // (index 1 + 1) / total 4
  });

  it('flips to the top when a spotlight rect sits low and central', () => {
    const beat: Beat = { id: 'b', text: 'tutorial.draw.intro', mode: 'info' };
    const { container } = render(
      <TutorialOverlay
        {...baseProps}
        beat={beat}
        spotRects={[{ x: 400, y: window.innerHeight - 60, w: 200, h: 80 }]}
      />,
    );
    expect(container.querySelector('.tut-coach')?.getAttribute('data-pos')).toBe('top');
  });

  it('the final beat of a non-last lesson advances straight to the next lesson (no "complete" step)', () => {
    let next = 0;
    const beat: Beat = { id: 'last', text: 'tutorial.draw.loco', mode: 'info' };
    const { getByText, queryByText } = render(
      <TutorialOverlay
        {...baseProps}
        beat={beat}
        index={3}
        total={4}
        isLastLesson={false}
        onNextLesson={() => {
          next += 1;
        }}
        spotRects={[]}
      />,
    );
    // The last beat's CTA is "next lesson", and the plain "next" advance is gone.
    expect(queryByText('tutorial.next')).toBeNull();
    getByText('tutorial.nextLesson').click();
    expect(next).toBe(1);
  });

  it('a finished non-last lesson shows no "lesson complete" copy — only the next-lesson CTA', () => {
    const { getByText, queryByText } = render(
      <TutorialOverlay
        {...baseProps}
        beat={null}
        done={true}
        index={4}
        total={4}
        isLastLesson={false}
        spotRects={[]}
      />,
    );
    expect(queryByText('tutorial.lessonComplete')).toBeNull();
    expect(getByText('tutorial.nextLesson')).toBeTruthy();
  });

  it('shows the celebratory finale + create-game CTA when the last lesson completes', () => {
    let created = 0;
    const { container, getByText } = render(
      <TutorialOverlay
        {...baseProps}
        beat={null}
        done={true}
        isLastLesson={true}
        onCreateGame={() => {
          created += 1;
        }}
        spotRects={[]}
      />,
    );
    expect(container.querySelector('.tut-coach--finale')).toBeTruthy();
    expect(container.querySelector('.tut-finale-title')).toBeTruthy();
    const cta = getByText('tutorial.createGame');
    cta.click();
    expect(created).toBe(1);
  });

  it('docks to the side (away from the target) for a full-height spotlight', () => {
    // A target filling the viewport height on the left (the whole map) can't be dodged up/down, so
    // the coach docks to the right and points back at it.
    const beat: Beat = { id: 'b', text: 'tutorial.welcome.map', mode: 'info' };
    const { container } = render(
      <TutorialOverlay
        {...baseProps}
        beat={beat}
        spotRects={[{ x: 0, y: 0, w: 200, h: window.innerHeight }]}
      />,
    );
    expect(container.querySelector('.tut-coach')?.getAttribute('data-pos')).toBe('right');
  });
});
