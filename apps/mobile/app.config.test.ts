// The app's display name is store metadata AND a native project name at the same time, and the two
// pull in opposite directions: App Review requires the on-device label to match the listing name
// (Guideline 2.3.8), while `expo prebuild` derives the Xcode project/workspace/scheme from the SAME
// string through `sanitizedName`, which deletes every non-word character. Chinese alone sanitizes to
// the fallback literal 'app' and would silently rename the project out from under fastlane's
// hardcoded ios/TRMission.xcworkspace. Pin both halves here — a rename that breaks the iOS lanes
// then fails in seconds instead of on a macOS runner.
//
// The locale labels are checked against fastlane/metadata, which is the checked-in copy of what the
// stores display, so renaming a listing without mirroring it into the app (or vice versa) fails here
// rather than at review.
import fs from 'node:fs';
import path from 'node:path';

import appConfig from './app.config';

/* eslint-disable @typescript-eslint/no-require-imports */
const { sanitizedName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj') as {
  sanitizedName(name: string): string;
};

/** One `locales` entry, narrowed from Expo's `string | Record<string, any>` union. */
type LocaleLabels = { ios: { CFBundleDisplayName: string }; android: { app_name: string } };

const locales = appConfig.locales as Record<string, LocaleLabels>;

/** A listing name as the store shows it (`fastlane/metadata/<platform>/<locale>/<file>`). */
const listingName = (relative: string) =>
  fs.readFileSync(path.join(__dirname, 'fastlane/metadata', relative), 'utf8').trim();

describe('app display name', () => {
  it('still sanitizes to the Xcode project name the Fastfile hardcodes', () => {
    expect(sanitizedName(appConfig.name)).toBe('TRMission');
  });

  // The label for any locale with no `locales` entry of its own, so it has to stand on its own
  // against both listings.
  it('falls back to a label carrying the listing name (Guideline 2.3.8)', () => {
    expect(appConfig.name).toContain('台鐵任務');
  });

  it.each([
    ['zh-Hant', 'ios/zh-Hant/name.txt'],
    ['en', 'ios/en-US/name.txt'],
  ])('labels %s devices exactly as the App Store lists the app there', (locale, metadata) => {
    expect(locales[locale].ios.CFBundleDisplayName).toBe(listingName(metadata));
  });

  // Play's titles lead with the Latin brand in BOTH locales, so equality is the wrong bar there —
  // what matters is that a Play user can still match the launcher label to the listing.
  it.each([
    ['zh-Hant', 'android/zh-TW/title.txt'],
    ['en', 'android/en-US/title.txt'],
  ])('labels %s devices consistently with the Play listing', (locale, metadata) => {
    const label = locales[locale].android.app_name;
    // One label per locale, whichever store the user got the app from.
    expect(label).toBe(locales[locale].ios.CFBundleDisplayName);
    const title = listingName(metadata);
    for (const token of label.split(' ')) expect(title).toContain(token);
  });
});
