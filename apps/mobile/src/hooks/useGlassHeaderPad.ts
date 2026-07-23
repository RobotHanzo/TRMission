import { useContext } from 'react';
import { Platform } from 'react-native';
import { HeaderHeightContext } from '@react-navigation/elements';

/** Top padding to reserve under the iOS Liquid Glass header (navigation.tsx sets
 *  `headerTransparent` there, so screen content now renders full-bleed behind it) — 0 on
 *  Android, where the header still reserves its own opaque layout row. Reads the context
 *  directly (not react-navigation's own `useHeaderHeight`, which throws outside a navigator)
 *  so screens still render standalone in unit tests. */
export function useGlassHeaderPad(): number {
  const height = useContext(HeaderHeightContext);
  return Platform.OS === 'ios' ? (height ?? 0) : 0;
}
