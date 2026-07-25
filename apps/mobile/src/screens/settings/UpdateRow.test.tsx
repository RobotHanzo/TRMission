import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

// expo-updates is a native module (requireNativeModule at import time) — mock it before the row,
// and before ../../ota, which reads `isEnabled` at module scope.
const mockCheck = jest.fn();
const mockFetch = jest.fn();
const mockReload = jest.fn();
jest.mock('expo-updates', () => ({
  isEnabled: true,
  checkForUpdateAsync: () => mockCheck(),
  fetchUpdateAsync: () => mockFetch(),
  reloadAsync: () => mockReload(),
}));

import i18n from '../../i18n';
import UpdateRow from './UpdateRow';

const NO_UPDATE = { isAvailable: false, manifest: undefined, isRollBackToEmbedded: false };
const UPDATE = { isAvailable: true, manifest: {}, isRollBackToEmbedded: false };

describe('UpdateRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReload.mockResolvedValue(undefined);
  });

  it('reports "up to date" without downloading anything', async () => {
    mockCheck.mockResolvedValue(NO_UPDATE);
    render(<UpdateRow first />);

    fireEvent.press(screen.getByTestId('settings-check-updates'));

    await waitFor(() => screen.getByText(i18n.t('settings.updateUpToDate')));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('downloads an available update and restarts when the user confirms', async () => {
    mockCheck.mockResolvedValue(UPDATE);
    mockFetch.mockResolvedValue({ isNew: true, manifest: {}, isRollBackToEmbedded: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      render(<UpdateRow first />);
      fireEvent.press(screen.getByTestId('settings-check-updates'));

      await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockReload).not.toHaveBeenCalled(); // never restarts under the user unprompted

      const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
      await act(async () => {
        buttons.find((b) => b.style !== 'cancel')!.onPress!();
      });
      expect(mockReload).toHaveBeenCalledTimes(1);
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('declining the restart leaves the row offering it', async () => {
    mockCheck.mockResolvedValue(UPDATE);
    mockFetch.mockResolvedValue({ isNew: true, manifest: {}, isRollBackToEmbedded: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      render(<UpdateRow first />);
      fireEvent.press(screen.getByTestId('settings-check-updates'));

      await waitFor(() => screen.getByText(i18n.t('settings.updateRestart')));
      fireEvent.press(screen.getByTestId('settings-check-updates'));
      expect(mockReload).toHaveBeenCalledTimes(1);
      expect(mockCheck).toHaveBeenCalledTimes(1); // the second press applies, it does not re-check
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('a roll back to the embedded bundle counts as an update', async () => {
    mockCheck.mockResolvedValue({
      isAvailable: false,
      manifest: undefined,
      isRollBackToEmbedded: true,
    });
    mockFetch.mockResolvedValue({ isNew: false, manifest: undefined, isRollBackToEmbedded: true });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      render(<UpdateRow first />);
      fireEvent.press(screen.getByTestId('settings-check-updates'));

      await waitFor(() => screen.getByText(i18n.t('settings.updateRestart')));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('a dev client says so instead of reporting a failure', async () => {
    mockCheck.mockRejectedValue(
      Object.assign(new Error('disabled'), {
        code: 'ERR_UPDATES_DISABLED',
      }),
    );
    render(<UpdateRow first />);

    fireEvent.press(screen.getByTestId('settings-check-updates'));

    await waitFor(() => screen.getByText(i18n.t('settings.updateUnavailable')));
  });

  it('a network failure is reported as one and stays retryable', async () => {
    mockCheck.mockRejectedValue(new Error('offline'));
    render(<UpdateRow first />);

    fireEvent.press(screen.getByTestId('settings-check-updates'));

    await waitFor(() => screen.getByText(i18n.t('settings.updateFailed')));

    mockCheck.mockResolvedValue(NO_UPDATE);
    fireEvent.press(screen.getByTestId('settings-check-updates'));
    await waitFor(() => screen.getByText(i18n.t('settings.updateUpToDate')));
  });
});
