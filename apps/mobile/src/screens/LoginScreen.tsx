import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { signInWithDiscord } from '../auth/discord';
import { signInWithGoogle } from '../auth/google';
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

      {/* "or" — the route glyph carries the divider: chrome quoting the board. */}
      <View style={styles.divider}>
        <RouteGlyph />
      </View>

      <View style={styles.providers}>
        <SecondaryButton
          title={t('login.guest')}
          onPress={() => void playAsGuest()}
          disabled={loading}
        />
        <SecondaryButton
          title={t('login.google')}
          onPress={() => void signInWithGoogle()}
          disabled={loading}
        />
        <SecondaryButton
          title={t('login.discord')}
          onPress={() => void signInWithDiscord()}
          disabled={loading}
        />
        {Platform.OS === 'ios' && (
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
      </View>

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && (
        <View style={styles.spinner}>
          <ErrorText>{error}</ErrorText>
        </View>
      )}
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
});
