import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
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
      <View style={styles.container}>
        <Text style={styles.title}>{t('boot.updateTitle')}</Text>
        <Text style={styles.body}>{t('boot.updateBody')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('home.title')}</Text>
      <ActivityIndicator style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 15, textAlign: 'center', opacity: 0.75 },
  spinner: { marginTop: 8 },
});
