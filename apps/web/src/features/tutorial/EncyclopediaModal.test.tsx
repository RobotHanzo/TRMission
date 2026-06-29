import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import EncyclopediaModal from './EncyclopediaModal';

describe('EncyclopediaModal', () => {
  it('renders a grouped, clickable entry list (not a bare select)', () => {
    const { container } = render(<EncyclopediaModal onClose={() => {}} />);
    expect(container.querySelector('.enc-list')).toBeTruthy();
    expect(container.querySelector('select.enc-select')).toBeNull();
    expect(container.querySelectorAll('.enc-entry').length).toBeGreaterThan(1);
  });

  it('leads with the topic title + blurb and a contained demo (no floating coachmark/scrim)', () => {
    const { container } = render(<EncyclopediaModal onClose={() => {}} />);
    expect(container.querySelector('.enc-entry-title')).toBeTruthy();
    expect(container.querySelector('.enc-blurb')).toBeTruthy();
    expect(container.querySelector('.enc-demo-stage')).toBeTruthy();
    expect(container.querySelector('.enc-caption')).toBeTruthy();
    // Option C is read-first: the demo uses an in-panel caption, never the full-screen tutorial's
    // viewport-fixed coachmark or its dim scrim.
    expect(document.querySelector('.tut-coach')).toBeNull();
    expect(document.querySelector('.tut-spotlight')).toBeNull();
  });
});
