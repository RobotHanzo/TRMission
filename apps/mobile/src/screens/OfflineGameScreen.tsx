// Offline play: LocalGameSession → isolated sandbox stores → the SAME GameStage as online.
// GAME_OVER scoring is P2's victory UI, driven by the snapshot exactly as a live game;
// this screen only adds offline banners + post-game CTAs.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Phase } from '@trm/proto';
import type { RootStackParamList } from '../navigation';
import { SandboxProvider } from '../store/sandboxProvider';
import { useGameStore, useGameStoreApi } from '../store/game';
import { useLogStoreApi } from '../store/log';
import { useLocalGame } from '../offline/useLocalGame';
import { GameStage } from './GameStage';

type Props = NativeStackScreenProps<RootStackParamList, 'OfflineGame'>;

function OfflineGameView({ route, navigation }: Props) {
  const { t } = useTranslation();
  const game = useGameStoreApi();
  const log = useLogStoreApi();
  const handle = useLocalGame(route.params, { game, log });
  const snapshot = useGameStore((s) => s.snapshot);
  const phase = snapshot?.phase;

  if (handle.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {handle.error === 'engine_version' || handle.error === 'unknown_content'
            ? t('offline.incompatible')
            : t('offline.loadFailed')}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.cta}
          onPress={() => navigation.popToTop()}
        >
          <Text style={styles.ctaText}>{t('offline.backHome')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!handle.ready || !handle.socket || !snapshot) {
    return <View style={styles.center} />;
  }

  return (
    <View style={styles.root}>
      {handle.saveBroken && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('offline.cantSave')}</Text>
        </View>
      )}
      {handle.resumeTruncated && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('offline.resumeTruncated')}</Text>
        </View>
      )}
      <GameStage
        snapshot={snapshot}
        sandbox
        commands={handle.socket}
        onLeave={() => navigation.popToTop()}
      />
      {phase === Phase.GAME_OVER && (
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            style={styles.cta}
            onPress={() => navigation.replace('OfflineSetup')}
          >
            <Text style={styles.ctaText}>{t('offline.playAgain')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.cta}
            onPress={() => navigation.popToTop()}
          >
            <Text style={styles.ctaText}>{t('offline.backHome')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function OfflineGameScreen(props: Props) {
  return (
    <SandboxProvider>
      <OfflineGameView {...props} />
    </SandboxProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  errorText: { fontSize: 15, textAlign: 'center' },
  banner: { backgroundColor: '#b5852a', paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#fff', fontSize: 13 },
  footer: { flexDirection: 'row', gap: 12, justifyContent: 'center', padding: 12 },
  cta: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#0f5fa6',
    minHeight: 44,
    justifyContent: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '700' },
});
