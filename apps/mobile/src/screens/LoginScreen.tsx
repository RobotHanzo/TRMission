import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { signInWithDiscord } from '../auth/discord';
import { signInWithGoogle } from '../auth/google';
import { useSession } from '../store/session';

/** The five sign-in methods P0 exposes: guest, email/password, Google, Apple (iOS), Discord. */
export function LoginScreen(): React.JSX.Element {
  const { t } = useTranslation();
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
    <View style={styles.container}>
      <Text style={styles.title}>{t('home.title')}</Text>
      <Text style={styles.tagline}>{t('login.tagline')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('login.email')}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
        editable={!loading}
      />
      {mode === 'register' && (
        <TextInput
          style={styles.input}
          placeholder={t('login.displayName')}
          value={displayName}
          onChangeText={setDisplayName}
          editable={!loading}
        />
      )}
      <TextInput
        style={styles.input}
        placeholder={t('login.password')}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!loading}
      />

      <Pressable style={styles.primary} onPress={submitPassword} disabled={loading}>
        <Text style={styles.primaryText}>
          {mode === 'login' ? t('login.signIn') : t('login.register')}
        </Text>
      </Pressable>
      <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')} disabled={loading}>
        <Text style={styles.link}>
          {mode === 'login' ? t('login.toRegister') : t('login.toLogin')}
        </Text>
      </Pressable>

      <Text style={styles.or}>{t('login.or')}</Text>

      <Pressable style={styles.secondary} onPress={() => void playAsGuest()} disabled={loading}>
        <Text style={styles.secondaryText}>{t('login.guest')}</Text>
      </Pressable>
      <Pressable
        style={styles.secondary}
        onPress={() => void signInWithGoogle()}
        disabled={loading}
      >
        <Text style={styles.secondaryText}>{t('login.google')}</Text>
      </Pressable>
      <Pressable
        style={styles.secondary}
        onPress={() => void signInWithDiscord()}
        disabled={loading}
      >
        <Text style={styles.secondaryText}>{t('login.discord')}</Text>
      </Pressable>
      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={8}
          style={styles.appleButton}
          onPress={() => void handleApple()}
        />
      )}

      {loading && <ActivityIndicator style={styles.spinner} />}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center' },
  tagline: { fontSize: 14, textAlign: 'center', opacity: 0.7, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16 },
  primary: { backgroundColor: '#1f6feb', borderRadius: 8, padding: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 16, fontWeight: '500' },
  appleButton: { height: 48, width: '100%' },
  link: { textAlign: 'center', color: '#1f6feb', paddingVertical: 6 },
  or: { textAlign: 'center', opacity: 0.5, marginVertical: 4 },
  spinner: { marginTop: 8 },
  error: { color: '#d33', textAlign: 'center', marginTop: 4 },
});
