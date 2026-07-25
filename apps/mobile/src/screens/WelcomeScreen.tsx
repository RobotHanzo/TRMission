// First entry: shown INSTEAD of the whole Home tab surface (mounted by HomeRoot, not by a tab) —
// ports the web WelcomeScreen: learn / practice / jump in, with the tutorial-recommendation nudge
// on the skip paths. Each path is a departure ticket; the recommended one carries the accent stripe.
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bot, CirclePlay, GraduationCap } from 'lucide-react-native';
import { openDiscord } from '../discord';
import { stageTier } from './stageLayout';
import { BrandWordmark, DepartureRow, RouteGlyph, Screen, SecondaryButton } from '../theme/chrome';
import { SPACE, useTheme } from '../theme/useTheme';

// First-entry gate (mobile adaptation of the web's 0-completed-games check, offline-friendly).
// Scoped per-account (the takeover only ever mounts once `user` exists) — otherwise a device that
// already dismissed the welcome under one account would skip it for every other, genuinely-new
// account that later signs in on the same device.
const WELCOME_SEEN_KEY = 'trm.welcome.seen.v1';
const seenKey = (userId: string): string => `${WELCOME_SEEN_KEY}:${userId}`;

/** Has this account never been offered the onboarding choice? Storage failures resolve to "no" —
 *  a missed welcome is a far smaller harm than one that reappears on every launch. */
export async function shouldShowWelcome(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(seenKey(userId))) === null;
  } catch {
    return false;
  }
}

/** Records that the choice was offered — written on every path out of the takeover. */
export async function markWelcomeSeen(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(seenKey(userId), '1');
  } catch {
    /* storage unavailable/full — worst case the welcome shows once more */
  }
}

export function WelcomeScreen({
  name,
  tutorialDone,
  onStartTutorial,
  onPractice,
  onContinue,
}: {
  name: string;
  tutorialDone: boolean;
  onStartTutorial(): void;
  onPractice(): void;
  onContinue(): void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const wide = stageTier(width) !== 'compact';

  // Practice/jump-in without the tutorial completed → recommend it once (native dialog).
  const recommend = (proceed: () => void): void => {
    if (tutorialDone) {
      proceed();
      return;
    }
    Alert.alert(t('home.tutorialRecommend.title'), t('home.tutorialRecommend.body'), [
      { text: t('home.tutorialRecommend.goToTutorial'), onPress: onStartTutorial },
      { text: t('home.tutorialRecommend.continueAnyway'), onPress: proceed },
    ]);
  };

  return (
    <Screen style={styles.screen}>
      <ScrollView contentContainerStyle={styles.welcome}>
        <View style={styles.welcomeBrand}>
          <BrandWordmark size="hero" />
          <RouteGlyph />
        </View>
        <Text style={[styles.welcomeTitle, { color: tokens.ink }]}>
          {t('home.welcome.title', { name })}
        </Text>
        <Text style={[styles.welcomeSubtitle, { color: tokens.inkSoft }]}>
          {t('home.welcome.subtitle')}
        </Text>
        <View style={[styles.welcomeOptions, wide && styles.welcomeOptionsWide]}>
          <DepartureRow
            testID="welcome-learn"
            stripe="accent"
            icon={<GraduationCap size={22} color={tokens.accent} />}
            title={t('home.welcome.learnTitle')}
            desc={t('home.welcome.learnDesc')}
            cta={t('home.welcome.learnCta')}
            onPress={onStartTutorial}
            style={wide && styles.welcomeOptionWide}
          />
          <DepartureRow
            testID="welcome-practice"
            stripe="quiet"
            icon={<Bot size={22} color={tokens.inkSoft} />}
            title={t('home.welcome.practiceTitle')}
            desc={t('home.welcome.practiceDesc')}
            cta={t('home.welcome.practiceCta')}
            onPress={() => recommend(onPractice)}
            style={wide && styles.welcomeOptionWide}
          />
          <DepartureRow
            testID="welcome-skip"
            stripe="quiet"
            icon={<CirclePlay size={22} color={tokens.inkSoft} />}
            title={t('home.welcome.skipTitle')}
            desc={t('home.welcome.skipDesc')}
            cta={t('home.welcome.skipCta')}
            onPress={() => recommend(onContinue)}
            style={wide && styles.welcomeOptionWide}
          />
        </View>
        <SecondaryButton title={t('home.welcome.discordCta')} onPress={openDiscord} />
        <Text style={[styles.welcomeFootnote, { color: tokens.inkSoft }]}>
          {t('home.welcome.footnote')}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The takeover owns the full screen (no tab bar under it), so it sets its own side margin —
  // the same 24dp gutter the rest of the app's chrome uses (issue #59).
  screen: { paddingHorizontal: SPACE[6] },
  // Station-sign hero (wordmark + route glyph), centered announcement, then the three departure
  // tickets. Vertically centered on tall phones; scrolls when short.
  welcome: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: SPACE[3],
    paddingVertical: SPACE[6],
  },
  welcomeBrand: { alignItems: 'center', gap: SPACE[4], marginBottom: SPACE[2] },
  welcomeTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 },
  welcomeSubtitle: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  welcomeOptions: { gap: SPACE[3], marginTop: SPACE[2], marginBottom: SPACE[2] },
  // Row layout on tablet/desktop (mirrors web's `.welcome-options` ≥701px row), capped to a
  // comfortable reading width instead of stretching three cards edge-to-edge.
  welcomeOptionsWide: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 900,
    gap: SPACE[4],
  },
  welcomeOptionWide: { flex: 1 },
  welcomeFootnote: { fontSize: 13, textAlign: 'center', marginTop: SPACE[1] },
});
