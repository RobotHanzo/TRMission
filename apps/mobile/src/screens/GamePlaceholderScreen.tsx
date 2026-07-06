import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

/** Placeholder for the in-game screen — P2 replaces this with the real Skia board. */
export function GamePlaceholderScreen({ route }: Props): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('game.placeholder')}</Text>
      <Text style={styles.meta}>{t('game.roomLabel', { code: route.params.roomCode })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  meta: { fontSize: 14, opacity: 0.6 },
});
