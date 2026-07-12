import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockRequestPermissions = jest.fn();
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
}));
const mockEnsure = jest.fn().mockResolvedValue(true);
const mockUnregister = jest.fn().mockResolvedValue(undefined);
jest.mock('../../push/register', () => ({
  ensurePushRegistration: (...a: unknown[]) => mockEnsure(...a),
  unregisterDeviceForPush: (...a: unknown[]) => mockUnregister(...a),
}));

import { useSettings } from '../../store/settings';
import NotificationsRow from './NotificationsRow';

describe('NotificationsRow', () => {
  beforeEach(() => {
    useSettings.setState({ notifications: false });
    jest.clearAllMocks();
  });

  it('toggling ON requests permission then registers', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: true });
    render(<NotificationsRow />);
    fireEvent(screen.getByTestId('notifications-switch'), 'valueChange', true);
    await waitFor(() => expect(mockEnsure).toHaveBeenCalled());
    expect(useSettings.getState().notifications).toBe(true);
  });

  it('permission denied leaves the toggle OFF', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    render(<NotificationsRow />);
    fireEvent(screen.getByTestId('notifications-switch'), 'valueChange', true);
    await waitFor(() => expect(mockRequestPermissions).toHaveBeenCalled());
    expect(useSettings.getState().notifications).toBe(false);
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('toggling OFF deregisters the device token', async () => {
    useSettings.setState({ notifications: true });
    render(<NotificationsRow />);
    fireEvent(screen.getByTestId('notifications-switch'), 'valueChange', false);
    await waitFor(() => expect(mockUnregister).toHaveBeenCalled());
    expect(useSettings.getState().notifications).toBe(false);
  });
});
