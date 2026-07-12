import { Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  TutorialTargetsProvider,
  useTutorialAnchor,
  TUTORIAL_ANCHORS,
  type MeasurableNode,
} from '../targets';
import { useSpotlightRects } from '../useSpotlightRects';
import type { ReadBoardCamera } from '../cameraBridge';
import type { Spotlight } from '../types';
import type { FlatRect } from '../focus';

// A registered anchor whose node fakes measureInWindow (the RN test env never lays out).
function FakeAnchor({ anchorId, rect }: { anchorId: string; rect: FlatRect }) {
  const anchor = useTutorialAnchor(anchorId);
  const node: MeasurableNode = {
    measureInWindow: (cb) => cb(rect.x, rect.y, rect.w, rect.h),
  };
  // Register the fake node directly through the callback ref.
  return <View ref={() => anchor.ref(node)} collapsable={false} />;
}

function Probe({ spotlight, readCamera }: { spotlight: Spotlight; readCamera: ReadBoardCamera }) {
  const rects = useSpotlightRects(spotlight, readCamera);
  return <Text testID="rects">{JSON.stringify(rects)}</Text>;
}

const identityCam: ReadBoardCamera = () => ({
  transform: { positionX: 0, positionY: 0, scale: 1 },
  proj: { k: 1, e: 0, f: 0 },
});

describe('useSpotlightRects (native)', () => {
  it('resolves a hud anchor through the registry', async () => {
    const r = render(
      <TutorialTargetsProvider>
        <FakeAnchor anchorId={TUTORIAL_ANCHORS.market} rect={{ x: 5, y: 600, w: 400, h: 90 }} />
        <Probe spotlight={{ kind: 'hud', selector: '.market' }} readCamera={identityCam} />
      </TutorialTargetsProvider>,
    );
    await waitFor(() =>
      expect(JSON.parse(r.getByTestId('rects').props.children as string)).toEqual([
        { x: 5, y: 600, w: 400, h: 90 },
      ]),
    );
  });

  it('projects a cities spotlight through the camera + board viewport anchor', async () => {
    const r = render(
      <TutorialTargetsProvider>
        <FakeAnchor anchorId={TUTORIAL_ANCHORS.board} rect={{ x: 0, y: 100, w: 800, h: 500 }} />
        <Probe spotlight={{ kind: 'cities', ids: ['hsinchu'] }} readCamera={identityCam} />
      </TutorialTargetsProvider>,
    );
    await waitFor(() => {
      const rects = JSON.parse(r.getByTestId('rects').props.children as string) as FlatRect[];
      expect(rects).toHaveLength(1);
      expect(rects[0]!.y).toBeGreaterThan(100); // sits inside the board viewport, camera-projected
    });
  });

  it('a named target that cannot resolve yields NO rects (never a bogus dim)', async () => {
    const r = render(
      <TutorialTargetsProvider>
        <Probe spotlight={{ kind: 'hud', selector: '.ticket-chooser' }} readCamera={identityCam} />
      </TutorialTargetsProvider>,
    );
    await act(async () => {});
    expect(JSON.parse(r.getByTestId('rects').props.children as string)).toEqual([]);
  });
});
