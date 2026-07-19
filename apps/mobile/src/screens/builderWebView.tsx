import { WebView } from 'react-native-webview';

/**
 * The builder's embedded-web leaf, split per platform (builderWebView.web.tsx renders an
 * iframe — react-native-webview has no web implementation). BuilderScreen owns the handoff
 * logic; this component only hosts the resulting URL.
 */
export function BuilderWebView({ uri }: { uri: string }): React.JSX.Element {
  return (
    <WebView
      source={{ uri }}
      // iOS: WKWebView shares NSHTTPCookieStorage so the Strict cookie set by the 302 sticks.
      sharedCookiesEnabled
      // Android: allow the same-origin refresh cookie inside the WebView.
      thirdPartyCookiesEnabled
      startInLoadingState
      // The builder is a same-origin SPA; external links (if any) stay inside — acceptable for v1.
    />
  );
}
