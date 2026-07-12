import { fireEvent, render, screen } from '@testing-library/react-native';

const mockRequestPermissions = jest.fn();
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
}));
const mockRegister = jest.fn().mockResolvedValue(undefined);
jest.mock('./register', () => ({
  registerDeviceForPush: (...a: unknown[]) => mockRegister(...a),
}));

import { useSettings } from '../store/settings';
import PushPrompt from './PushPrompt';

describe('PushPrompt (contextual, one-shot)', () => {
  beforeEach(() => {
    useSettings.setState({ notifications: false, pushPromptSeen: false });
    jest.clearAllMocks();
  });

  it('accept: requests OS permission, registers, flips the toggle, never shows again', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    render(<PushPrompt />);
    fireEvent.press(screen.getByTestId('push-prompt-accept'));
    await Promise.resolve();
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(useSettings.getState().pushPromptSeen).toBe(true);
    expect(useSettings.getState().notifications).toBe(true);
  });

  it('dismiss: marks seen without requesting anything', () => {
    render(<PushPrompt />);
    fireEvent.press(screen.getByTestId('push-prompt-dismiss'));
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(useSettings.getState().pushPromptSeen).toBe(true);
  });

  it('renders nothing once seen', () => {
    useSettings.setState({ pushPromptSeen: true });
    render(<PushPrompt />);
    expect(screen.queryByTestId('push-prompt-accept')).toBeNull();
  });
});
