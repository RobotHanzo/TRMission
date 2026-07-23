import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { api } from '../net/rest';
import { SERVER_ORIGIN } from '../config';
import { useSession } from '../store/session';
import { useTheme } from '../theme/useTheme';
import { useGlassHeaderPad } from '../hooks/useGlassHeaderPad';
import { BuilderWebView } from './builderWebView';

/** Entry gate: mirror of web's useHasFeature('mapBuilder') — cosmetic; server 403s regardless. */
export function useCanBuild(): boolean {
  return useSession((s) => !!s.user?.features?.includes('mapBuilder'));
}

/**
 * The map builder is the live web app in a WebView ("WebView now, native later" — spec §7).
 * Session handoff: mint a single-use carry code over Bearer, then load
 * GET /api/v1/auth/mobile-web-handoff?code=… — the server sets the normal Strict refresh
 * cookie inside the WebView's cookie store and 302s to /maps. A fresh code is minted on
 * every mount (codes are single-use); old web session families age out server-side.
 */
export default function BuilderScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const headerPad = useGlassHeaderPad();
  const net = useNetInfo();
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const online = net.isConnected !== false;

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    setFailed(false);
    api
      .mobileCarry()
      .then(({ code }) => {
        if (cancelled) return;
        setHandoffUrl(
          `${SERVER_ORIGIN}/api/v1/auth/mobile-web-handoff?code=${encodeURIComponent(code)}`,
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  if (!online) {
    return (
      <View style={[styles.fill, { paddingTop: headerPad }]}>
        <View style={styles.center} testID="builder-offline">
          <Text style={[styles.title, { color: tokens.ink }]}>{t('builder.offlineTitle')}</Text>
          <Text style={[styles.body, { color: tokens.inkSoft }]}>{t('builder.offlineBody')}</Text>
        </View>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.fill, { paddingTop: headerPad }]}>
        <View style={styles.center} testID="builder-error">
          <Text style={[styles.title, { color: tokens.ink }]}>{t('builder.errorTitle')}</Text>
          <Text style={[styles.body, { color: tokens.inkSoft }]}>{t('builder.errorBody')}</Text>
        </View>
      </View>
    );
  }
  if (!handoffUrl) {
    return (
      <View style={[styles.fill, { paddingTop: headerPad }]}>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.fill, { paddingTop: headerPad }]}>
      <BuilderWebView uri={handoffUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 14, textAlign: 'center', opacity: 0.7 },
});
