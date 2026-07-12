import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  TutorialTargetsProvider,
  useTutorialAnchor,
  useTutorialTargets,
  TUTORIAL_ANCHORS,
  type TutorialTargets,
} from '../targets';

function Probe({ onTargets }: { onTargets: (t: TutorialTargets) => void }) {
  onTargets(useTutorialTargets());
  const anchor = useTutorialAnchor(TUTORIAL_ANCHORS.market);
  return <View {...anchor} testID="probe" />;
}

describe('useTutorialAnchor', () => {
  it('registers into the provider and sets collapsable={false}', async () => {
    let targets: TutorialTargets | null = null;
    const r = render(
      <TutorialTargetsProvider>
        <Probe onTargets={(t) => (targets = t)} />
      </TutorialTargetsProvider>,
    );
    expect(r.getByTestId('probe').props.collapsable).toBe(false);
    // jsdom-less RN test env: measureInWindow yields nothing → 0-sized → dropped, but the
    // registration path itself must not throw and must resolve to an array.
    await expect(targets!.measure(TUTORIAL_ANCHORS.market)).resolves.toBeInstanceOf(Array);
    r.unmount(); // unmount must unregister without throwing
  });

  it('is a safe no-op outside the provider (live game)', () => {
    const r = render(<Probe onTargets={() => {}} />);
    expect(r.getByTestId('probe')).toBeTruthy();
  });
});
