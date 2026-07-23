import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bot, CirclePlay, GraduationCap, History, Map as MapIcon } from 'lucide-react-native';
import type { HomeTabScreenProps } from '../navigation';
import { api, type RoomView } from '../net/rest';
import { openDiscord } from '../discord';
import { useSession } from '../store/session';
import { useOnline } from '../hooks/useOnline';
import { OfflineHomeBanner } from '../components/OfflineHomeBanner';
import { OfflineHomeSection } from '../offline/OfflineHomeSection';
import { getTutorialCompletion } from '../features/tutorial/progress';
import { useTabBarPad } from '../hooks/useTabBarPad';
import { useCanBuild } from './BuilderScreen';
import { stageTier } from './stageLayout';
import {
  BrandWordmark,
  DepartureRow,
  Field,
  PrimaryButton,
  RouteGlyph,
  Screen,
  SecondaryButton,
  SectionLabel,
} from '../theme/chrome';
import { RADIUS, SPACE, useTheme } from '../theme/useTheme';

type Props = HomeTabScreenProps<'Home'>;

// First-entry gate (mobile adaptation of the web's 0-completed-games check, offline-friendly):
// the welcome takes over the homepage until the user picks a path or finishes the tutorial.
const WELCOME_SEEN_KEY = 'trm.welcome.seen.v1';

/** Room codes set like train numbers — the departure-board voice for anything joinable. */
function CodeChip({ code }: { code: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <Text style={[styles.codeChip, { backgroundColor: tokens.surface2, color: tokens.ink }]}>
      {code}
    </Text>
  );
}

/** First entry: shown instead of the homepage (ports the web WelcomeScreen — learn / practice /
 *  jump in, with the tutorial-recommendation nudge on the skip paths). Each path is a departure
 *  ticket; the recommended one carries the accent stripe. */
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

  return (
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
          stripe="accent"
          icon={<GraduationCap size={22} color={tokens.accent} />}
          title={t('home.welcome.learnTitle')}
          desc={t('home.welcome.learnDesc')}
          cta={t('home.welcome.learnCta')}
          onPress={onStartTutorial}
          style={wide && styles.welcomeOptionWide}
        />
        <DepartureRow
          stripe="quiet"
          icon={<Bot size={22} color={tokens.inkSoft} />}
          title={t('home.welcome.practiceTitle')}
          desc={t('home.welcome.practiceDesc')}
          cta={t('home.welcome.practiceCta')}
          onPress={() => recommend(onPractice)}
          style={wide && styles.welcomeOptionWide}
        />
        <DepartureRow
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
      <Text style={[styles.rowMeta, { color: tokens.ink }]}>{t('login.guestNotice')}</Text>
      {!open ? (
        <SecondaryButton title={t('login.createAccount')} onPress={() => setOpen(true)} />
      ) : (
        <View style={styles.guestForm}>
          <Text style={[styles.rowMeta, { color: tokens.inkSoft }]}>
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
          {error && <Text style={[styles.rowMeta, { color: tokens.danger }]}>{error}</Text>}
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
  const online = useOnline();
  const canBuild = useCanBuild();
  const { width } = useWindowDimensions();
  const wide = stageTier(width) !== 'compact';
  // Screen already pads the safe-area bottom; the floating iOS tab bar occludes more than that,
  // so add the difference (0 on Android/web, where the bar takes its own layout space).
  const insets = useSafeAreaInsets();
  const tabExtra = Math.max(0, useTabBarPad() - insets.bottom);
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

  if (showWelcome) {
    return (
      // The explicit paddingBottom overrides Screen's own safe-area pad on this View, so it
      // must re-include insets.bottom under the tab-bar extra.
      <Screen
        style={[
          styles.container,
          tabExtra > 0 && { paddingBottom: insets.bottom + tabExtra },
        ]}
      >
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
    <View style={[styles.header, { borderBottomColor: tokens.line }]}>
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
    <DepartureRow
      testID="home-tutorial"
      stripe="quiet"
      icon={<GraduationCap size={22} color={tokens.inkSoft} />}
      title={t('home.play.tutorialTitle')}
      desc={t('home.play.tutorialDesc')}
      meta={
        tutorialDone ? (
          <Text testID="home-tutorial-done" style={[styles.tutorialDone, { color: tokens.ok }]}>
            ✓
          </Text>
        ) : undefined
      }
      onPress={() => navigation.navigate('Tutorial')}
    />
  );

  const myRoomsSection = rooms.length > 0 && (
    <>
      <SectionLabel>{t('home.myRooms')}</SectionLabel>
      {rooms.map((item) => (
        <DepartureRow
          key={item.code}
          title={<CodeChip code={item.code} />}
          desc={t('home.playersCount', { n: item.members.length, max: item.maxPlayers })}
          onPress={() => navigation.navigate('Room', { code: item.code })}
        />
      ))}
    </>
  );

  // Public rooms: the whole row boards — join a lobby, or watch a game already underway.
  const publicRoomsSection = online && (
    <>
      <SectionLabel>{t('home.publicRooms')}</SectionLabel>
      {publicRooms.length === 0 ? (
        <Text style={[styles.rowMeta, { color: tokens.inkSoft }]}>{t('home.noPublicRooms')}</Text>
      ) : (
        publicRooms.map((r) => (
          <DepartureRow
            key={r.code}
            title={<CodeChip code={r.code} />}
            desc={`${t('home.playersCount', { n: r.members.length, max: r.maxPlayers })} · ${
              r.status === 'LOBBY' ? t('home.statusLobby') : t('home.statusPlaying')
            }`}
            trailing={
              <Text style={[styles.verbPill, { color: tokens.accent, borderColor: tokens.line }]}>
                {r.status === 'LOBBY' ? t('home.join') : t('home.watch')}
              </Text>
            }
            onPress={() =>
              r.status === 'LOBBY'
                ? navigation.navigate('Room', { code: r.code })
                : navigation.navigate('Game', { roomCode: r.code, spectator: true })
            }
          />
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

  // The quiet utility footer: timetable footnotes, not a second menu. Builder is
  // feature-gated (mapBuilder) and hidden entirely without the grant — mirrors web AppHeader.
  const pill = (
    testID: string,
    icon: React.JSX.Element,
    label: string,
    onPress: () => void,
    disabled = false,
  ): React.JSX.Element => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: tokens.surface, borderColor: tokens.line },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon}
      <Text style={[styles.pillText, { color: tokens.ink }]}>{label}</Text>
    </Pressable>
  );

  // Encyclopedia/Leaderboard/Settings moved to the floating tab bar (HomeTabs) — linking to them
  // again from here would just duplicate a destination the tab bar already surfaces. Only the
  // still push-only destinations (feature-gated Builder, History) remain quick links.
  const pillIcon = { size: 16, color: tokens.inkSoft } as const;
  const linkPills = (
    <View style={styles.pillRow}>
      {canBuild &&
        pill(
          'home-builder',
          <MapIcon {...pillIcon} />,
          t('builder.entry'),
          () => navigation.navigate('Builder'),
          !online,
        )}
      {online &&
        pill('home-history', <History {...pillIcon} />, t('history.title'), () =>
          navigation.navigate('History'),
        )}
    </View>
  );

  // Phones stay a single scrolling column (unchanged); tablets/desktops split into a web-style
  // two-pane grid — primary room-joining flow on the left, secondary links on the right.
  return (
    <Screen scroll style={[styles.container, { paddingBottom: SPACE[8] + tabExtra }]}>
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
            {linkPills}
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
          {linkPills}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: SPACE[4], paddingHorizontal: SPACE[6], gap: SPACE[3] },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: SPACE[3],
  },
  greeting: { fontSize: 17, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  rowMeta: { fontSize: 14 },
  codeChip: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  verbPill: {
    fontSize: 13,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  joinRow: { flexDirection: 'row', gap: SPACE[2], alignItems: 'stretch' },
  joinInput: { flex: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  tutorialDone: { fontSize: 16, fontWeight: '700' },
  guestCard: { borderWidth: 1, borderRadius: RADIUS.md, padding: 14, gap: 10 },
  guestForm: { gap: 8 },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACE[2],
    marginTop: SPACE[2],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: { fontSize: 14, fontWeight: '600' },
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
  // The welcome takeover: station-sign hero (wordmark + route glyph), centered announcement,
  // then the three departure tickets. Vertically centered on tall phones; scrolls when short.
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
