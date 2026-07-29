// Issue #76: the strip is the scrubber, so it has to take a drag and not just a tap — and it has
// to seek to where the finger actually is, which only holds while the painted layers stay out of
// the touch path (`locationX` is measured from whichever view the touch landed on).
import { render, screen } from '@testing-library/react-native';
import type { Action } from '@trm/engine';
import type { ReplayControls } from '@trm/client-core/replay/useReplayPlayer';
import '../../i18n'; // side-effect i18next init (zh-Hant default)
import { ReplayTransport } from './ReplayTransport';

/** A one-finger touch history the responder-system wrappers can read (they compute the gesture
 *  state from it, not from the event itself). */
const touchEvent = (x: number, t: number, startX = x) => {
  const touch = {
    touchActive: true,
    startPageX: startX,
    startPageY: 0,
    startTimeStamp: 0,
    currentPageX: x,
    currentPageY: 0,
    currentTimeStamp: t,
    previousPageX: startX,
    previousPageY: 0,
    previousTimeStamp: 0,
  };
  return {
    nativeEvent: { touches: [{ identifier: 0 }], locationX: x, locationY: 0, pageX: x, pageY: 0 },
    touchHistory: {
      touchBank: [touch],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: t,
    },
  };
};

const actions = (n: number): Action[] =>
  Array.from(
    { length: n },
    (_, i) => ({ t: 'DRAW_DECK', player: i % 2 === 0 ? 'p1' : 'p2' }) as unknown as Action,
  );

const controls = (over: Partial<ReplayControls> = {}): ReplayControls => ({
  step: 0,
  total: 100,
  playing: false,
  viewer: null,
  atEnd: false,
  error: false,
  speed: 1,
  animate: false,
  setViewer: jest.fn(),
  setSpeed: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  next: jest.fn(),
  prev: jest.fn(),
  seek: jest.fn(),
  ...over,
});

function mount(player: ReplayControls) {
  render(
    <ReplayTransport
      actions={actions(player.total)}
      players={[
        { userId: 'p1', seat: 0, displayName: 'A' },
        { userId: 'p2', seat: 1, displayName: 'B' },
      ]}
      player={player}
      playerName={(turn) => turn.id}
    />,
  );
  const strip = screen.getByTestId('replay-strip');
  strip.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
  return strip;
}

describe('ReplayTransport strip', () => {
  it('seeks to the pressed position', () => {
    const player = controls();
    const strip = mount(player);
    strip.props.onStartShouldSetResponder(touchEvent(0, 0));
    strip.props.onResponderGrant(touchEvent(50, 0)); // a quarter along 200dp of 100 steps
    expect(player.seek).toHaveBeenLastCalledWith(25);
  });

  it('tracks the finger while dragging, not just the initial press', () => {
    const player = controls();
    const strip = mount(player);
    strip.props.onStartShouldSetResponder(touchEvent(0, 0));
    strip.props.onResponderGrant(touchEvent(20, 0));
    expect(player.seek).toHaveBeenLastCalledWith(10);
    strip.props.onResponderMove(touchEvent(160, 1, 20));
    expect(player.seek).toHaveBeenLastCalledWith(80);
    strip.props.onResponderMove(touchEvent(6, 2, 20));
    expect(player.seek).toHaveBeenLastCalledWith(3);
  });

  it('clamps a drag that runs off either end of the strip', () => {
    const player = controls();
    const strip = mount(player);
    strip.props.onStartShouldSetResponder(touchEvent(0, 0));
    strip.props.onResponderGrant(touchEvent(100, 0));
    strip.props.onResponderMove(touchEvent(-400, 1, 100));
    expect(player.seek).toHaveBeenLastCalledWith(0);
    strip.props.onResponderMove(touchEvent(900, 2, 100));
    expect(player.seek).toHaveBeenLastCalledWith(100);
  });

  it('refuses to hand the gesture back mid-drag', () => {
    // The replay screen is a native-stack route; on iOS the back-swipe would otherwise claim a
    // drag that starts near the left edge.
    const strip = mount(controls());
    expect(strip.props.onResponderTerminationRequest(touchEvent(10, 1))).toBe(false);
  });

  it('keeps the painted layers out of the touch path', () => {
    // `locationX` is measured from the view the touch landed ON. If a turn section could take the
    // touch, a press would be measured from that section's left edge and seek somewhere else.
    const strip = mount(controls());
    expect(strip.children).toHaveLength(1);
    expect((strip.children[0] as { props: { pointerEvents?: string } }).props.pointerEvents).toBe(
      'none',
    );
  });

  it('exposes the playhead to assistive tech, and steps it', () => {
    const player = controls({ step: 40 });
    const strip = mount(player);
    expect(strip.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
    strip.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    expect(player.seek).toHaveBeenLastCalledWith(41);
    strip.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    expect(player.seek).toHaveBeenLastCalledWith(39);
  });

  it('ignores a press on an empty log rather than seeking into nothing', () => {
    const player = controls({ total: 0, atEnd: true });
    const strip = mount(player);
    strip.props.onResponderGrant(touchEvent(50, 0));
    expect(player.seek).not.toHaveBeenCalled();
  });
});
