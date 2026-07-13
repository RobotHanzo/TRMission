import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList } from '../navigation';
import { api, type RoomView } from '../net/rest';
import { openDiscord } from '../discord';
import { useSession } from '../store/session';
import { useOnline } from '../hooks/useOnline';
import { OfflineHomeBanner } from '../components/OfflineHomeBanner';
import { OfflineHomeSection } from '../offline/OfflineHomeSection';
import { getTutorialCompletion } from '../features/tutorial/progress';
import { useCanBuild } from './BuilderScreen';
import { stageTier } from './stageLayout';
import {
  BrandWordmark,
  Field,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionLabel,
} from '../theme/chrome';
import { RADIUS, SPACE, useTheme } from '../theme/useTheme';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// First-entry gate (mobile adaptation of the web's 0-completed-games check, offline-friendly):
// the welcome takes over the homepage until the user picks a path or finishes the tutorial.
const WELCOME_SEEN_KEY = 'trm.welcome.seen.v1';

/** First entry: shown instead of the homepage (ports the web WelcomeScreen — learn / practice /
 *  jump in, with the tutorial-recommendation nudge on the skip paths). */
function WelcomeCard({
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

  const option = (
    title: string,
    desc: string,
    cta: string,
    onPress: () => void,
    primary = false,
  ): React.JSX.Element => (
    <View
      style={[
        styles.welcomeOption,
        wide && styles.welcomeOptionWide,
        { backgroundColor: tokens.surface, borderColor: tokens.line },
      ]}
    >
      <Text style={[styles.roomCode, { color: tokens.ink }]}>{title}</Text>
      <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>{desc}</Text>
      {primary ? (
        <PrimaryButton title={cta} onPress={onPress} />
      ) : (
        <SecondaryButton title={cta} onPress={onPress} />
      )}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.welcome}>
      <View style={styles.welcomeBrand}>
        <BrandWordmark size="hero" />
      </View>
      <Text style={[styles.welcomeTitle, { color: tokens.ink }]}>
        {t('home.welcome.title', { name })}
      </Text>
      <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>{t('home.welcome.subtitle')}</Text>
      <View style={[styles.welcomeOptions, wide && styles.welcomeOptionsWide]}>
        {option(
          t('home.welcome.learnTitle'),
          t('home.welcome.learnDesc'),
          t('home.welcome.learnCta'),
          onStartTutorial,
          true,
        )}
        {option(
          t('home.welcome.practiceTitle'),
          t('home.welcome.practiceDesc'),
          t('home.welcome.practiceCta'),
          () => recommend(onPractice),
        )}
        {option(
          t('home.welcome.skipTitle'),
          t('home.welcome.skipDesc'),
          t('home.welcome.skipCta'),
          () => recommend(onContinue),
        )}
      </View>
      <SecondaryButton title={t('home.welcome.discordCta')} onPress={openDiscord} />
      <Text style={[styles.roomMeta, styles.welcomeFootnote, { color: tokens.inkSoft }]}>
        {t('home.welcome.footnote')}
      </Text>
    </ScrollView>
  );
}

/** The guest nudge: a one-line notice that expands into the upgrade form in place (ports the
 *  web GuestUpgradeCard). A successful upgrade flips `user.isGuest` and the card disappears. */
function GuestUpgradeCard(): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const loading = useSession((s) => s.loading);
  const error = useSession((s) => s.error);
  const upgrade = useSession((s) => s.upgrade);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <View
      style={[styles.guestCard, { backgroundColor: tokens.surface, borderColor: tokens.line }]}
      testID="guest-upgrade-card"
    >
      <Text style={[styles.roomMeta, { color: tokens.ink }]}>{t('login.guestNotice')}</Text>
      {!open ? (
        <SecondaryButton title={t('login.createAccount')} onPress={() => setOpen(true)} />
      ) : (
        <View style={styles.guestForm}>
          <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
            {t('login.upgradeBlurb')}
          </Text>
          <Field
            placeholder={t('login.email')}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Field
            placeholder={t('login.password')}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />
          <PrimaryButton
            title={t('login.createAccount')}
            disabled={loading || !email || password.length < 8}
            onPress={() => void upgrade(email, password)}
          />
          {error && <Text style={[styles.roomMeta, { color: tokens.danger }]}>{error}</Text>}
        </View>
      )}
    </View>
  );
}

/** The lobby home: play offline vs bots, rejoin an active room, or create/join a room. */
export function HomeScreen({ navigation }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const { tokens } = useTheme();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const online = useOnline();
  const canBuild = useCanBuild();
  const { width } = useWindowDimensions();
  const wide = stageTier(width) !== 'compact';
  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [publicRooms, setPublicRooms] = useState<RoomView[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Bumped on focus so the offline section remounts and reloads its resume list (a finished or
  // abandoned game must drop off it when the user navigates back here).
  const [focusKey, setFocusKey] = useState(0);
  // Loaded on focus: returning from the tutorial's finale must light the badge immediately.
  const [tutorialDone, setTutorialDone] = useState(false);
  // First-entry welcome takeover: null while unknown (no flash either way).
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRooms(await api.getMyRooms());
    } catch {
      /* ignore — the rejoin list is best-effort */
    }
    try {
      setPublicRooms(await api.getPublicRooms());
    } catch {
      /* best-effort too */
    }
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      void refresh();
      setFocusKey((k) => k + 1);
      void getTutorialCompletion().then((c) => {
        setTutorialDone(c !== null);
        // A finished tutorial is a resolved onboarding — never re-show the welcome.
        if (c !== null) setShowWelcome(false);
        else
          AsyncStorage.getItem(WELCOME_SEEN_KEY).then(
            (seen) => setShowWelcome(seen === null),
            () => setShowWelcome(false),
          );
      });
    });
    return unsub;
  }, [navigation, refresh]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    void AsyncStorage.setItem(WELCOME_SEEN_KEY, '1').catch(() => undefined);
  }, []);

  // The public-rooms list stays fresh while the screen is up (web polls the same 5s cadence).
  useEffect(() => {
    if (!online) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [online, refresh]);

  const createRoom = async (): Promise<void> => {
    setBusy(true);
    try {
      const room = await api.createRoom();
      navigation.navigate('Room', { code: room.code });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (): Promise<void> => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy(true);
    try {
      const room = await api.joinRoom(trimmed);
      setCode('');
      navigation.navigate('Room', { code: room.code });
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const rowStyle = ({ pressed }: { pressed: boolean }) => [
    styles.roomRow,
    { backgroundColor: tokens.surface, borderColor: tokens.line },
    pressed && styles.pressed,
  ];

  if (showWelcome) {
    return (
      <Screen style={styles.container}>
        <WelcomeCard
          name={user?.displayName ?? ''}
          tutorialDone={tutorialDone}
          onStartTutorial={() => {
            dismissWelcome();
            navigation.navigate('Tutorial');
          }}
          onPractice={() => {
            dismissWelcome();
            navigation.navigate('OfflineSetup');
          }}
          onContinue={dismissWelcome}
        />
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <BrandWordmark />
      <Text style={[styles.greeting, { color: tokens.ink }]}>
        {t('home.greeting', { name: user?.displayName ?? '' })}
      </Text>
    </View>
  );

  // Guests get the keep-your-progress nudge (hidden once upgraded or offline).
  const guestCard = online && user?.isGuest === true && <GuestUpgradeCard />;

  // Offline play never gates on connectivity (Apple 4.2 posture).
  const offlineSection = (
    <OfflineHomeSection
      key={focusKey}
      onNewGame={() => navigation.navigate('OfflineSetup')}
      onResume={(gameId) => navigation.navigate('OfflineGame', { mode: 'resume', gameId })}
    />
  );

  // The tutorial is fully offline too — never gated on connectivity or an account.
  const tutorialRow = (
    <Pressable
      accessibilityRole="button"
      testID="home-tutorial"
      style={rowStyle}
      onPress={() => navigation.navigate('Tutorial')}
    >
      <View style={styles.tutorialText}>
        <Text style={[styles.roomCode, { color: tokens.ink }]}>
          {t('home.play.tutorialTitle')}
        </Text>
        <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
          {t('home.play.tutorialDesc')}
        </Text>
      </View>
      {tutorialDone && (
        <Text testID="home-tutorial-done" style={[styles.tutorialDone, { color: tokens.ok }]}>
          ✓
        </Text>
      )}
    </Pressable>
  );

  const myRoomsSection = rooms.length > 0 && (
    <>
      <SectionLabel>{t('home.myRooms')}</SectionLabel>
      {rooms.map((item) => (
        <Pressable
          key={item.code}
          style={rowStyle}
          onPress={() => navigation.navigate('Room', { code: item.code })}
        >
          <Text style={[styles.roomCode, { color: tokens.ink }]}>{item.code}</Text>
          <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
            {t('home.playersCount', { n: item.members.length, max: item.maxPlayers })}
          </Text>
        </Pressable>
      ))}
    </>
  );

  // Public rooms: join a lobby, or watch a game already underway (spectate).
  const publicRoomsSection = online && (
    <>
      <SectionLabel>{t('home.publicRooms')}</SectionLabel>
      {publicRooms.length === 0 ? (
        <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
          {t('home.noPublicRooms')}
        </Text>
      ) : (
        publicRooms.map((r) => (
          <View
            key={r.code}
            style={[styles.roomRow, { backgroundColor: tokens.surface, borderColor: tokens.line }]}
          >
            <View style={styles.publicInfo}>
              <Text style={[styles.roomCode, { color: tokens.ink }]}>{r.code}</Text>
              <Text style={[styles.roomMeta, { color: tokens.inkSoft }]}>
                {t('home.playersCount', { n: r.members.length, max: r.maxPlayers })} ·{' '}
                {r.status === 'LOBBY' ? t('home.statusLobby') : t('home.statusPlaying')}
              </Text>
            </View>
            {r.status === 'LOBBY' ? (
              <SecondaryButton
                title={t('home.join')}
                onPress={() => navigation.navigate('Room', { code: r.code })}
              />
            ) : (
              <SecondaryButton
                title={t('home.watch')}
                onPress={() => navigation.navigate('Game', { roomCode: r.code, spectator: true })}
              />
            )}
          </View>
        ))
      )}
    </>
  );

  const joinRow = (
    <View style={styles.joinRow}>
      <Field
        style={[styles.joinInput, !online && styles.disabled]}
        placeholder={t('home.joinPlaceholder')}
        autoCapitalize="characters"
        value={code}
        onChangeText={setCode}
        editable={!busy && online}
      />
      <View style={!online && styles.disabled}>
        <SecondaryButton
          title={t('home.join')}
          onPress={() => void joinRoom()}
          disabled={busy || !online}
        />
      </View>
    </View>
  );

  const createButton = (
    <PrimaryButton
      title={t('home.create')}
      onPress={() => void createRoom()}
      disabled={busy || !online}
    />
  );

  // Feature-gated (mapBuilder), hidden entirely without the grant — mirrors web AppHeader.
  const builderLink = canBuild && (
    <SecondaryButton
      testID="home-builder"
      title={t('builder.entry')}
      onPress={() => navigation.navigate('Builder')}
      disabled={!online}
    />
  );

  const encyclopediaLink = (
    <Pressable
      testID="home-encyclopedia"
      accessibilityRole="button"
      onPress={() => navigation.navigate('Encyclopedia')}
    >
      <Text style={[styles.settingsLink, { color: tokens.blue }]}>{t('tutorial.open')}</Text>
    </Pressable>
  );

  const historyLink = online && (
    <Pressable
      testID="home-history"
      accessibilityRole="button"
      onPress={() => navigation.navigate('History')}
    >
      <Text style={[styles.settingsLink, { color: tokens.blue }]}>{t('history.title')}</Text>
    </Pressable>
  );

  const settingsLink = (
    <Pressable
      testID="home-settings"
      accessibilityRole="button"
      onPress={() => navigation.navigate('Settings')}
    >
      <Text style={[styles.settingsLink, { color: tokens.blue }]}>{t('settings.title')}</Text>
    </Pressable>
  );

  const signOutLink = (
    <Pressable onPress={() => void signOut()}>
      <Text style={[styles.signOut, { color: tokens.danger }]}>{t('home.signOut')}</Text>
    </Pressable>
  );

  // Phones stay a single scrolling column (unchanged); tablets/desktops split into a web-style
  // two-pane grid — primary room-joining flow on the left, secondary links on the right.
  return (
    <Screen scroll style={styles.container}>
      {header}
      {!online && <OfflineHomeBanner />}
      {!wide && guestCard}
      {wide ? (
        <View style={styles.grid}>
          <View style={styles.gridMain}>
            {offlineSection}
            {myRoomsSection}
            {publicRoomsSection}
            {joinRow}
            {createButton}
          </View>
          <View style={styles.gridSide}>
            {tutorialRow}
            {guestCard}
            {encyclopediaLink}
            {builderLink}
            {historyLink}
            {settingsLink}
            {signOutLink}
          </View>
        </View>
      ) : (
        <>
          {offlineSection}
          {tutorialRow}
          {myRoomsSection}
          {publicRoomsSection}
          {joinRow}
          {createButton}
          {builderLink}
          {encyclopediaLink}
          {historyLink}
          {settingsLink}
          {signOutLink}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: SPACE[4], gap: SPACE[3] },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  greeting: { fontSize: 18, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  roomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    marginBottom: SPACE[2],
  },
  roomCode: { fontSize: 16, fontWeight: '700' },
  roomMeta: { fontSize: 14 },
  joinRow: { flexDirection: 'row', gap: SPACE[2], alignItems: 'stretch' },
  joinInput: { flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  settingsLink: { textAlign: 'center', marginTop: SPACE[2], fontWeight: '500' },
  signOut: { textAlign: 'center', marginTop: SPACE[1] },
  tutorialText: { gap: 2, flexShrink: 1 },
  tutorialDone: { fontSize: 18, fontWeight: '700' },
  publicInfo: { gap: 2, flexShrink: 1 },
  guestCard: { borderWidth: 1, borderRadius: RADIUS.md, padding: 14, gap: 10 },
  guestForm: { gap: 8 },
  // Two-pane tablet/desktop layout (stageTier !== 'compact', ≥700dp): mirrors web's
  // `.home-grid` (1.6fr rooms/1fr side rail), capped so it doesn't stretch edge-to-edge on
  // large screens (web caps `.app-main.app-main--home` at 980px the same way).
  grid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 900,
    gap: SPACE[4],
  },
  gridMain: { flex: 1.6, gap: SPACE[3] },
  gridSide: { flex: 1, gap: SPACE[3] },
  welcome: { gap: SPACE[3], paddingBottom: SPACE[8] },
  welcomeBrand: { alignItems: 'center', marginTop: SPACE[4] },
  welcomeTitle: { fontSize: 22, fontWeight: '800' },
  welcomeOptions: { gap: SPACE[3] },
  // Row layout on tablet/desktop (mirrors web's `.welcome-options` ≥701px row), capped to a
  // comfortable reading width instead of stretching three cards edge-to-edge.
  welcomeOptionsWide: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 900,
    gap: SPACE[4],
  },
  welcomeOption: { borderWidth: 1, borderRadius: RADIUS.md, padding: 14, gap: 8 },
  welcomeOptionWide: { flex: 1 },
  welcomeFootnote: { textAlign: 'center', marginTop: SPACE[2] },
});
