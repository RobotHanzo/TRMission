import { render, screen } from '@testing-library/react-native';
import { VolumeSlider } from './VolumeSlider';

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
    nativeEvent: { touches: [{ identifier: 0 }], locationX: x, locationY: 0 },
    touchHistory: {
      touchBank: [touch],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: t,
    },
  };
};

describe('VolumeSlider', () => {
  it('claims the gesture on capture and refuses to hand it back', () => {
    // The slider sits inside the settings ScrollView. Without these, the ScrollView takes the
    // responder over the moment the finger moves — the slider is then tappable but not draggable.
    render(<VolumeSlider testID="volume-slider" value={0.5} onChange={jest.fn()} />);
    const view = screen.getByTestId('volume-slider');
    expect(view.props.onStartShouldSetResponderCapture(touchEvent(0, 0))).toBe(true);
    expect(view.props.onMoveShouldSetResponderCapture(touchEvent(10, 1))).toBe(true);
    expect(view.props.onResponderTerminationRequest(touchEvent(10, 1))).toBe(false);
  });

  it('tracks the finger while dragging, not just the initial press', () => {
    const onChange = jest.fn();
    render(<VolumeSlider testID="volume-slider" value={0} onChange={onChange} />);
    const view = screen.getByTestId('volume-slider');
    view.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    view.props.onStartShouldSetResponderCapture(touchEvent(0, 0));
    view.props.onResponderGrant(touchEvent(20, 0));
    expect(onChange).toHaveBeenLastCalledWith(0.1);
    view.props.onResponderMove(touchEvent(120, 1, 20));
    expect(onChange).toHaveBeenLastCalledWith(0.6);
  });

  it('reports its value to assistive tech', () => {
    render(<VolumeSlider testID="volume-slider" value={0.4} onChange={jest.fn()} />);
    expect(screen.getByTestId('volume-slider').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 40,
    });
  });
});
