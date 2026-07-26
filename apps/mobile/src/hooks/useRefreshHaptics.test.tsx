import { render, fireEvent } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSettings } from '../store/settings';
import { useRefreshHaptics } from './useRefreshHaptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

function Harness({ onRefresh }: { onRefresh: () => void }): React.JSX.Element {
  const refresh = useRefreshHaptics(onRefresh);
  return (
    <Pressable testID="refresh" onPress={refresh}>
      <Text>pull</Text>
    </Pressable>
  );
}

describe('useRefreshHaptics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettings.getState().setHaptics(true);
  });

  it('buzzes and still refreshes', () => {
    const onRefresh = jest.fn();
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    fireEvent.press(getByTestId('refresh'));
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes without buzzing when the setting is off', () => {
    useSettings.getState().setHaptics(false);
    const onRefresh = jest.fn();
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    fireEvent.press(getByTestId('refresh'));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected native call', () => {
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('no motor'));
    const onRefresh = jest.fn();
    const { getByTestId } = render(<Harness onRefresh={onRefresh} />);
    expect(() => fireEvent.press(getByTestId('refresh'))).not.toThrow();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
