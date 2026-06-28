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
});
