import { render } from '@testing-library/react-native';
import { TutorialSpotlight } from '../TutorialSpotlight';

describe('TutorialSpotlight', () => {
  it('renders nothing when a named target has not resolved (no holes, no dimAll)', () => {
    const r = render(<TutorialSpotlight rects={[]} reducedMotion={false} />);
    expect(r.toJSON()).toBeNull();
  });
  it('renders the global dim when the beat intends the whole stage', () => {
    const r = render(<TutorialSpotlight rects={[]} reducedMotion dimAll />);
    expect(r.getByTestId('tut-spotlight')).toBeTruthy();
  });
  it('renders the scrim + rings and never blocks touches', () => {
    const r = render(
      <TutorialSpotlight rects={[{ x: 10, y: 10, w: 100, h: 40 }]} reducedMotion={false} />,
    );
    expect(r.getByTestId('tut-spotlight').props.pointerEvents).toBe('none');
  });
});
