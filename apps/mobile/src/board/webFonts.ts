// Board label fonts for the react-native-web harness. On NATIVE the paragraph builder resolves
// against the platform's system font collection (PingFang / Noto Sans TC) — this module is a
// permanent no-op there (and under jest). On WEB, CanvasKit cannot see system fonts at all: a
// paragraph with no registered typeface silently shapes zero CJK glyphs, which is why the board
// rendered without any station names. setup-web.js serves Noto Sans TC from /fonts/; this module
// fetches the faces once and registers them into a TypefaceFontProvider that BoardText passes to
// the paragraph builder. Loading is a progressive enhancement: until (or unless) it resolves,
// labels simply stay absent, exactly like the pre-font behavior.
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Skia, type SkTypefaceFontProvider } from '@shopify/react-native-skia';

/** The family name BoardText's text style asks for when a provider is present. */
export const BOARD_FONT_FAMILY = 'Noto Sans TC';

const FONT_URLS = ['/fonts/NotoSansTC_400Regular.ttf', '/fonts/NotoSansTC_700Bold.ttf'];

let provider: SkTypefaceFontProvider | null = null;
let started = false;
const subscribers = new Set<() => void>();

/** Loader breadcrumb for harness debugging (`window.__trmFonts` in devtools/Playwright). */
const trace = (state: string): void => {
  (globalThis as { __trmFonts?: string }).__trmFonts = state;
};

const start = (): void => {
  if (started || Platform.OS !== 'web') return;
  started = true;
  void (async () => {
    try {
      if (typeof Skia.TypefaceFontProvider?.Make !== 'function') {
        trace('no-provider-api');
        return;
      }
      trace('fetching');
      const p = Skia.TypefaceFontProvider.Make();
      let registered = 0;
      for (const url of FONT_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            trace(`fetch-${res.status}:${url}`);
            continue;
          }
          const data = Skia.Data.fromBytes(new Uint8Array(await res.arrayBuffer()));
          const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
          if (typeface) {
            p.registerFont(typeface, BOARD_FONT_FAMILY);
            registered += 1;
          } else {
            trace(`no-typeface:${url}`);
          }
        } catch (e) {
          trace(`register-error:${String(e).slice(0, 80)}`);
        }
      }
      if (registered > 0) {
        provider = p;
        trace(`registered:${registered}`);
        subscribers.forEach((notify) => notify());
      }
    } catch (e) {
      // No fonts — labels stay a progressive enhancement, never a crash.
      trace(`error:${String(e).slice(0, 80)}`);
    }
  })();
};

/** The web font provider once loaded; null on native, under jest, and while the fetch is in
 *  flight. Subscribing components re-render when the fonts land. */
export function useBoardFontProvider(): SkTypefaceFontProvider | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      start();
      subscribers.add(onStoreChange);
      return () => subscribers.delete(onStoreChange);
    },
    () => provider,
  );
}
