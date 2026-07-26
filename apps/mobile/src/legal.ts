// The two public legal documents (paths shared with web via @trm/client-core), opened from the
// sign-in notice and Settings ▸ Ads & privacy.
//
// **In-app browser, not `Linking.openURL`.** Store compliance (Apple 5.1.1 / Play) wants the policy
// reachable *in* the app, and handing an https URL to the OS is the one step that can refuse: iOS
// rejects `openURL` whenever the system declines to hand the URL to a browser — a restricted or
// absent default browser, or a link the app's own Associated Domains claim — which surfaced as
// "Unable to open URL: …/privacy" (TRMISSION-MOBILE-2). `openBrowserAsync` renders
// SFSafariViewController / a Custom Tab in-process instead, so no hand-off can fail. Rejections are
// swallowed for the same reason `openDiscord` swallows its own: a legal link that won't open is a
// dead press, never a crash report.
import * as WebBrowser from 'expo-web-browser';
import { LEGAL_PATHS, type LegalDoc } from '@trm/client-core/legal';
import { SERVER_ORIGIN } from './config';

export type { LegalDoc };

export function openLegalDoc(doc: LegalDoc): void {
  WebBrowser.openBrowserAsync(`${SERVER_ORIGIN}${LEGAL_PATHS[doc]}`).catch(() => undefined);
}
