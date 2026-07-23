import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { BrandWordmark, Card, MutedText, Screen } from '../theme/chrome';
import { useTheme } from '../theme/useTheme';
import { BUILD_NUMBER } from '../config';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { checkForcedUpdate } from '../version';

/** Release the native splash (App.tsx prevented auto-hide); safe to call more than once. */
const releaseSplash = (): void => {
  void SplashScreen.hideAsync().catch(() => undefined);
};

/**
 * The splash + boot sequence: forced-update check → hydrate prefs → restore session. When restore
 * flips `booting` to false, RootNavigator swaps to Home (authed) or Login. A forced update keeps us
 * here on the update wall (booting stays true), so the app can't proceed on an unsupported build.
 */
export function BootScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const restore = useSession((s) => s.restore);
  const [mustUpdate, setMustUpdate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await checkForcedUpdate(BUILD_NUMBER);
      if (cancelled) return;
      if (result.mustUpdate) {
        setMustUpdate(true);
        releaseSplash(); // the update wall must be visible
        return;
      }
      await useUi.getState().hydrate();
      if (cancelled) return;
      await restore();
    })();
    // Unmount = `booting` flipped false and the real stack replaced us → show the app.
    return () => {
      cancelled = true;
      releaseSplash();
    };
  }, [restore]);

  if (mustUpdate) {
    return (
      <Screen centered style={styles.container}>
        <Card style={styles.updateCard}>
          <Text style={[styles.title, { color: tokens.ink }]}>{t('boot.updateTitle')}</Text>
          <MutedText center>{t('boot.updateBody')}</MutedText>
        </Card>
      </Screen>
    );
  }

  // The native splash is still covering this in the normal path — content only shows if hide
  // raced ahead; keep it on-brand rather than a bare app title.
  return (
    <Screen centered style={styles.container}>
      <BrandWordmark size="hero" />
      <ActivityIndicator style={styles.spinner} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  updateCard: { maxWidth: 420, alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  spinner: { marginTop: 8 },
});
