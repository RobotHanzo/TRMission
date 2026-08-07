// The public help page (issue #80) — the URL App Store Connect and Play are given as this app's
// support contact. It is a page of the web app, so mobile opens it on the configured server origin.
//
// **In-app browser, not `Linking.openURL`**, for exactly the reasons `legal.ts` documents: iOS
// refuses `openURL` whenever the system declines to hand the URL to a browser, and a support link
// that won't open is the worst possible dead press. Rejections are swallowed the same way.
import * as WebBrowser from 'expo-web-browser';
import { SUPPORT_PATH } from '@trm/client-core/links';
import { SERVER_ORIGIN } from './config';

export function openSupport(): void {
  WebBrowser.openBrowserAsync(`${SERVER_ORIGIN}${SUPPORT_PATH}`).catch(() => undefined);
}
