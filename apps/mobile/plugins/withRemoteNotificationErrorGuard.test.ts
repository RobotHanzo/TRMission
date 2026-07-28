// Runs the AppDelegate patch in withRemoteNotificationErrorGuard.js against the REAL Expo SDK 56
// bare template (`__fixtures__/expo-sdk56-bare-AppDelegate.swift`, verbatim from
// expo-template-bare-minimum@56.0.31), because `expo prebuild -p ios` refuses to run off macOS and
// nobody on this project owns a Mac. It cannot compile the injected Swift — the macOS lane does
// that — so what it pins is the part that silently rots: the anchors. A template that moves must
// FAIL the prebuild, never quietly drop the guard.
import fs from 'node:fs';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-require-imports */
// The plugin is CommonJS (Expo requires it that way) and ships no types.
const { applyRemoteNotificationErrorGuard, MARKER } =
  require('./withRemoteNotificationErrorGuard') as {
    applyRemoteNotificationErrorGuard(contents: string, opts: { errorDomain: string }): string;
    MARKER: string;
  };
/* eslint-enable @typescript-eslint/no-require-imports */

const TEMPLATE = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'expo-sdk56-bare-AppDelegate.swift'),
  'utf8',
);
const DOMAIN = 'dev.robothanzo.trmission.remote-notifications';

const patch = (contents: string = TEMPLATE): string =>
  applyRemoteNotificationErrorGuard(contents, { errorDomain: DOMAIN });

describe('withRemoteNotificationErrorGuard', () => {
  it('injects the guard into the SDK 56 template', () => {
    const out = patch();

    expect(out).toContain(MARKER);
    // The whole point: the crashing selector is re-implemented with a NULLABLE error.
    expect(out).toContain(
      'NSSelectorFromString("application:didFailToRegisterForRemoteNotificationsWithError:")',
    );
    expect(out).toContain('@convention(block) (AnyObject, UIApplication, NSError?) -> Void');
    expect(out).toContain('method_setImplementation(method, imp_implementationWithBlock(guarded))');
    expect(out).toContain(`domain: "${DOMAIN}"`);
    // ...installed from a hook the template does NOT already override (two overrides of
    // didFinishLaunchingWithOptions in one class would not compile).
    expect(out).toContain('willFinishLaunchingWithOptions launchOptions');
    expect(TEMPLATE).not.toContain('willFinishLaunchingWithOptions');
    // `class_getInstanceMethod` & co. come from a module the template doesn't import.
    expect(TEMPLATE).not.toContain('import ObjectiveC');
    expect(out.match(/^import ObjectiveC$/gm)).toHaveLength(1);
    // Injected INSIDE the class, above `var window`, not after its closing brace.
    expect(out.indexOf(MARKER)).toBeGreaterThan(
      out.indexOf('class AppDelegate: ExpoAppDelegate {'),
    );
    expect(out.indexOf(MARKER)).toBeLessThan(out.indexOf('var window: UIWindow?'));
    // Nothing the template already did was dropped or unbalanced.
    expect(out).toContain('factory.startReactNative(');
    expect(out.split('{')).toHaveLength(out.split('}').length);
  });

  it('is idempotent — a re-run of prebuild over a patched file changes nothing', () => {
    const once = patch();
    expect(patch(once)).toBe(once);
  });

  it('throws when the template no longer declares `class AppDelegate: ExpoAppDelegate`', () => {
    const renamed = TEMPLATE.replace(
      'class AppDelegate: ExpoAppDelegate {',
      'class ExpoAppDelegateSubclass: ExpoAppDelegate {',
    );
    expect(() => patch(renamed)).toThrow(/AppDelegate.swift/);
  });

  it('accepts an access modifier on the class declaration', () => {
    const exported = TEMPLATE.replace(
      'class AppDelegate: ExpoAppDelegate {',
      'public final class AppDelegate: ExpoAppDelegate {',
    );
    expect(patch(exported)).toContain(MARKER);
  });
});
