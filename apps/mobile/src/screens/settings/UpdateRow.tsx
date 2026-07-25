import { useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import { RefreshCw, RotateCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { OTA_SUPPORTED, applyOtaUpdate, fetchOtaUpdate, type OtaOutcome } from '../../ota';
import { useTheme } from '../../theme/useTheme';
import { RowValue, SettingsRow } from './chrome';

/**
 * Settings ▸ About: check for an OTA update now, download it, and restart into it (`../../ota.ts`).
 * The app checks by itself on every cold start, so this row is for the user who has just been told
 * a fix is out and does not want to wait for the next launch.
 *
 * One row, three shapes: an action ("Check for updates"), its result stated in the value slot
 * (up to date / failed / not available in this build), and — once a bundle is downloaded — the
 * restart that applies it. The state never resets itself; a stale "Up to date" is a press away
 * from being re-checked.
 */
export default function UpdateRow({ first }: { first?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const [state, setState] = useState<'idle' | 'checking' | OtaOutcome>(
    OTA_SUPPORTED ? 'idle' : 'unsupported',
  );

  // Resolves immediately before the reload is posted to the main thread — nothing may follow it.
  const restart = (): void => void applyOtaUpdate();

  const check = async (): Promise<void> => {
    setState('checking');
    const outcome = await fetchOtaUpdate();
    setState(outcome);
    if (outcome !== 'ready') return;
    // Asking beats restarting under someone: they may be mid-game. Declining leaves the row in its
    // 'ready' shape, and the update applies on the next cold start anyway.
    Alert.alert(t('settings.updateReadyTitle'), t('settings.updateReadyBody'), [
      { text: t('settings.updateLater'), style: 'cancel' },
      { text: t('settings.updateRestartNow'), onPress: restart },
    ]);
  };

  const ready = state === 'ready';
  const busy = state === 'checking';
  const status =
    state === 'upToDate'
      ? t('settings.updateUpToDate')
      : state === 'failed'
        ? t('settings.updateFailed')
        : state === 'unsupported'
          ? t('settings.updateUnavailable')
          : null;

  return (
    <SettingsRow
      first={first ?? false}
      testID="settings-check-updates"
      tone={ready ? 'link' : 'default'}
      icon={ready ? RotateCw : RefreshCw}
      label={ready ? t('settings.updateRestart') : t('settings.checkForUpdates')}
      disabled={busy || state === 'unsupported'}
      // No press target where OTA does not exist: the row degrades to a stated fact, like Version.
      onPress={state === 'unsupported' ? undefined : ready ? restart : () => void check()}
      trailing={
        busy ? (
          <ActivityIndicator size="small" color={tokens.inkSoft} />
        ) : status != null ? (
          <RowValue>{status}</RowValue>
        ) : undefined
      }
    />
  );
}
