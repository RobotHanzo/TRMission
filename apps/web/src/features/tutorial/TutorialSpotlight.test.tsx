import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TutorialSpotlight } from './TutorialSpotlight';

afterEach(cleanup);

describe('TutorialSpotlight', () => {
  it('renders one ring and one mask cutout per target rect', () => {
    render(
      <TutorialSpotlight
        rects={[
          { x: 10, y: 10, w: 100, h: 50 },
          { x: 200, y: 300, w: 80, h: 40 },
        ]}
        reducedMotion={false}
      />,
    );
    expect(document.querySelectorAll('.tut-spotlight-ring').length).toBe(2);
    expect(document.querySelectorAll('#tut-spot-mask rect[fill="black"]').length).toBe(2);
  });

  it('renders a global dim with no cutouts when there are no targets', () => {
    render(<TutorialSpotlight rects={[]} reducedMotion={false} />);
    expect(document.querySelector('.tut-spotlight')).toBeTruthy();
    expect(document.querySelectorAll('.tut-spotlight-ring').length).toBe(0);
  });

  it('does not pulse under reduced motion', () => {
    render(<TutorialSpotlight rects={[{ x: 0, y: 0, w: 10, h: 10 }]} reducedMotion={true} />);
    expect(document.querySelector('.tut-spotlight-ring.pulse')).toBeNull();
  });
});
