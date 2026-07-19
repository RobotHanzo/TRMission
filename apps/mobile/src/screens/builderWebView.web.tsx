/**
 * Web-harness variant of the builder's embedded-web leaf: a plain iframe. The handoff URL sets
 * its refresh cookie inside the frame — browsers that block third-party cookies may keep the
 * builder from authenticating here; that's acceptable for the Playwright harness (the builder
 * IS the web app, so web-side coverage tests apps/web directly).
 */
export function BuilderWebView({ uri }: { uri: string }): React.JSX.Element {
  return <iframe title="builder" src={uri} style={{ flex: 1, width: '100%', border: 0 }} />;
}
