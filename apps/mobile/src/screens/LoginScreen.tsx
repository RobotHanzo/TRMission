import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import { GOOGLE_WEB_CLIENT_ID, SERVER_ORIGIN } from '../config';
import { signInWithApple } from '../auth/apple';
import { signInWithDiscord } from '../auth/discord';
import { signInWithGoogle } from '../auth/google';
import { api, type AuthConfig } from '../net/rest';
import { useSession } from '../store/session';
import {
  BrandWordmark,
  Card,
  ErrorText,
  Field,
  LinkButton,
  MutedText,
  PrimaryButton,
  RouteGlyph,
  Screen,
  SecondaryButton,
} from '../theme/chrome';
import { AppleIcon, DiscordIcon, GoogleIcon } from '../theme/brandIcons';
import { SPACE, useTheme } from '../theme/useTheme';

/** The five sign-in methods P0 exposes: guest, email/password, Google, Apple (iOS), Discord. */
export function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const { dark } = useTheme();
  const error = useSession((s) => s.error);
  const loading = useSession((s) => s.loading);
  const playAsGuest = useSession((s) => s.playAsGuest);
  const login = useSession((s) => s.login);
  const register = useSession((s) => s.register);
  const loginWithAppleCredential = useSession((s) => s.loginWithAppleCredential);

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [guestName, setGuestName] = useState('');

  // Only the server-enabled sign-in methods render (ports the web auth-config gate). An
  // unreachable server keeps everything visible — the buttons themselves surface the failure.
  const [config, setConfig] = useState<AuthConfig | null>(null);
  useEffect(() => {
    let live = true;
    api
      .config()
      .then((c) => live && setConfig(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const passwordOn = config?.passwordLogin ?? true;
  const guestOn = config?.guest ?? true;
  // Server-enabled AND locally provisioned: without baked client ids the native Google SDK can
  // only no-op, and a visibly dead sign-in button is a routine store-review rejection.
  const googleOn = (config?.providers.google ?? true) && !!GOOGLE_WEB_CLIENT_ID;
  const discordOn = config?.providers.discord ?? true;
  const appleOn = (config?.providers.apple ?? true) && Platform.OS === 'ios';
  // Android has no native SIWA: the server's redirect flow runs in a system browser instead —
  // it needs the Apple Services ID configured (`appleRedirect`), not just the native audiences.
  const appleWebOn = Platform.OS !== 'ios' && !!config?.providers.appleRedirect;

  const submitPassword = (): void => {
    if (mode === 'login') void login(email, password);
    else void register(email, password, displayName);
  };

  const handleApple = async (): Promise<void> => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) return;
      const fullName =
        [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter(Boolean)
          .join(' ')
          .trim() || undefined;
      await loginWithAppleCredential(credential.identityToken, fullName);
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return; // user cancelled
      throw e;
    }
  };

  return (
    <Screen scroll centered>
      <View style={styles.brand}>
        <BrandWordmark size="hero" />
        <MutedText center>{t('login.tagline')}</MutedText>
      </View>

      {passwordOn && (
        <Card style={styles.form}>
          <Field
            placeholder={t('login.email')}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          {mode === 'register' && (
            <Field
              placeholder={t('login.displayName')}
              value={displayName}
              onChangeText={setDisplayName}
              editable={!loading}
            />
          )}
          <Field
            placeholder={t('login.password')}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />
          <PrimaryButton
            title={mode === 'login' ? t('login.signIn') : t('login.register')}
            onPress={submitPassword}
            disabled={loading}
          />
          <LinkButton
            title={mode === 'login' ? t('login.toRegister') : t('login.toLogin')}
            onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
            disabled={loading}
          />
        </Card>
      )}

      {/* "or" — the route glyph carries the divider: chrome quoting the board. */}
      <View style={styles.divider}>
        <RouteGlyph />
      </View>

      <View style={styles.providers}>
        {guestOn && (
          <>
            <Field
              placeholder={t('login.guestName')}
              value={guestName}
              maxLength={24}
              onChangeText={setGuestName}
              editable={!loading}
            />
            <SecondaryButton
              title={t('login.guest')}
              onPress={() => void playAsGuest(guestName)}
              disabled={loading}
            />
          </>
        )}
        {googleOn && (
          <SecondaryButton
            title={t('login.google')}
            icon={<GoogleIcon />}
            onPress={() => void signInWithGoogle()}
            disabled={loading}
          />
        )}
        {discordOn && (
          <SecondaryButton
            title={t('login.discord')}
            icon={<DiscordIcon />}
            onPress={() => void signInWithDiscord()}
            disabled={loading}
          />
        )}
        {appleOn && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              dark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={10}
            style={styles.appleButton}
            onPress={() => void handleApple()}
          />
        )}
        {appleWebOn && (
          <SecondaryButton
            title={t('login.apple')}
            icon={<AppleIcon color={dark ? '#fff' : '#000'} />}
            onPress={() => void signInWithApple()}
            disabled={loading}
          />
        )}
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && (
        <View style={styles.spinner}>
          <ErrorText>{error}</ErrorText>
        </View>
      )}

      {/* Store compliance: the privacy policy is reachable from the sign-in surface too. */}
      <View style={styles.footer}>
        <LinkButton
          title={t('settings.privacyPolicy')}
          onPress={() => void Linking.openURL(`${SERVER_ORIGIN}/privacy`)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: SPACE[2], marginBottom: SPACE[6] },
  form: { alignSelf: 'center', width: '100%', maxWidth: 420 },
  divider: { marginVertical: SPACE[4] },
  providers: { alignSelf: 'center', width: '100%', maxWidth: 420, gap: SPACE[2] },
  appleButton: { height: 48, width: '100%' },
  spinner: { marginTop: SPACE[3] },
  footer: { marginTop: SPACE[4], alignItems: 'center' },
});
