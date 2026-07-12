// A slim status strip over the game: the device is offline (NetInfo) or the socket is between
// retries. Purely informational — the socket's own backoff and useGameConnection's foreground
// re-mint do the actual recovering.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { useGame } from '../store/game';

export function OfflineBanner(): React.JSX.Element | null {
  const { t } = useTranslation();
  const status = useGame((s) => s.status);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) =>
      setOffline(state.isConnected === false),
    );
    return unsubscribe;
  }, []);

  if (!offline && status !== 'reconnecting') return null;
  return (
    <View style={styles.banner} pointerEvents="none">
      <Text style={styles.text}>{t(offline ? 'game.offlineBanner' : 'game.reconnecting')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#b3261e',
    paddingVertical: 6,
    alignItems: 'center',
  },
  text: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
