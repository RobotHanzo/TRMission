// The app's display name is store metadata AND a native project name at the same time, and the two
// pull in opposite directions: App Review requires the on-device label to carry the listing's
// Chinese name (Guideline 2.3.8), while `expo prebuild` derives the Xcode project/workspace/scheme
// from the SAME string through `sanitizedName`, which deletes every non-word character. Chinese
// alone sanitizes to the fallback literal 'app' and would silently rename the project out from
// under fastlane's hardcoded ios/TRMission.xcworkspace. Pin both halves here — a rename that breaks
// the iOS lanes then fails in seconds instead of on a macOS runner.
import appConfig from './app.config';

/* eslint-disable @typescript-eslint/no-require-imports */
const { sanitizedName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj') as {
  sanitizedName(name: string): string;
};

describe('app display name', () => {
  it('contains the App Store listing name (Guideline 2.3.8)', () => {
    expect(appConfig.name).toContain('台鐵任務');
  });

  it('still sanitizes to the Xcode project name the Fastfile hardcodes', () => {
    expect(sanitizedName(appConfig.name)).toBe('TRMission');
  });
});
