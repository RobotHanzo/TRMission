// Resolves the persisted theme preference ('system' | 'light' | 'dark', store/ui.ts) against the
// OS scheme into the shared chrome token palette — the mobile analogue of web's
// data-theme="light"|"dark" stamp on <html>. Every chrome surface styles through this hook;
// hardcoded hexes in screens are a bug.
import { useColorScheme } from 'react-native';
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  RADIUS,
  SPACE,
  type ChromeTokens,
} from '@trm/client-core/theme/tokens';
import { useUi } from '../store/ui';

export { RADIUS, SPACE, type ChromeTokens };

export interface AppTheme {
  tokens: ChromeTokens;
  dark: boolean;
}

export function resolveTheme(pref: 'system' | 'light' | 'dark', systemDark: boolean): AppTheme {
  const dark = pref === 'dark' || (pref === 'system' && systemDark);
  return { tokens: dark ? DARK_TOKENS : LIGHT_TOKENS, dark };
}

export function useTheme(): AppTheme {
  const pref = useUi((s) => s.theme);
  const scheme = useColorScheme();
  return resolveTheme(pref, scheme === 'dark');
}
