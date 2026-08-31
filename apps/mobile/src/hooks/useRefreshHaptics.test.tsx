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

  it('buzzes and still refreshes', async () => {
    const onRefresh = jest.fn();
    const { getByTestId } = await render(<Harness onRefresh={onRefresh} />);
    await fireEvent.press(getByTestId('refresh'));
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes without buzzing when the setting is off', async () => {
    useSettings.getState().setHaptics(false);
    const onRefresh = jest.fn();
    const { getByTestId } = await render(<Harness onRefresh={onRefresh} />);
    await fireEvent.press(getByTestId('refresh'));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected native call', async () => {
    (Haptics.impactAsync as jest.Mock).mockRejectedValueOnce(new Error('no motor'));
    const onRefresh = jest.fn();
    const { getByTestId } = await render(<Harness onRefresh={onRefresh} />);
    // Must not reject/throw even though the native call underneath does.
    await fireEvent.press(getByTestId('refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
