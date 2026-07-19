// Metro runtime first (web HMR + async requires; no-op on native), then the Hermes shims —
// which MUST import before anything touches protobuf/i18n (see src/shims.ts).
import '@expo/metro-runtime';
import './src/shims';
import { Platform } from 'react-native';
import type * as SkiaWebModule from '@shopify/react-native-skia/lib/module/web';
import type * as ExpoModule from 'expo';
import type * as AppModule from './App';

/* eslint-disable @typescript-eslint/no-require-imports */
if (Platform.OS === 'web') {
  // Web (the desktop Playwright harness): Skia's web build reads the global CanvasKit at module
  // scope, so the app graph may only be EVALUATED after LoadSkiaWeb resolves — hence inline
  // require()s (bundled statically, evaluated lazily; Metro's dev-mode lazy bundling can't
  // serve dynamic import() from this entry). canvaskit.wasm is served from public/ (copied
  // there by scripts/setup-web.js).
  require('./src/web/alertShim'); // RNW's Alert is a no-op; map it onto window.confirm/alert
  const { LoadSkiaWeb } = require(
    '@shopify/react-native-skia/lib/module/web',
  ) as typeof SkiaWebModule;
  void LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
    const { registerRootComponent } = require('expo') as typeof ExpoModule;
    const App = (require('./App') as typeof AppModule).default;
    registerRootComponent(App);
  });
} else {
  const { registerRootComponent } = require('expo') as typeof ExpoModule;
  const App = (require('./App') as typeof AppModule).default;
  registerRootComponent(App);
}
/* eslint-enable @typescript-eslint/no-require-imports */
