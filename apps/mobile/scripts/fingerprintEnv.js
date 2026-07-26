#!/usr/bin/env node
// The env-var half of the OTA runtimeVersion contract (issue #62).
//
// `runtimeVersion: { policy: 'fingerprint' }` hashes the EVALUATED app config, so every env var
// app.config.ts reads into a field the fingerprint sees is a fingerprint input — and the store
// lanes and the OTA publish lane must therefore evaluate the config under identical values, or a
// published update is invisible to the binary it was meant for. That is not theoretical:
// mobile-android.yml has never set TRM_GOOGLE_IOS_URL_SCHEME, so every Android binary it built
// baked the `com.googleusercontent.apps.placeholder` fallback while every publish used the real
// value, and no Android device ever saw an OTA. iOS set it on both sides and worked fine, which is
// why the asymmetry went unnoticed. `.github/workflows/mobile-ios.yml` even called the var
// "iOS-only": its NATIVE effect is (a CFBundleURLScheme in Info.plist), but it is passed as a
// config-PLUGIN PROP, and the `plugins` array is platform-agnostic and hashed for both platforms.
//
// Two modes, both cheap enough to run unconditionally:
//
//   --assert  Every var in FINGERPRINT_ENV is set and non-empty. Run inside the same env block
//             that evaluates app.config.ts for a shipped artifact (both store lanes' prebuild AND
//             build steps, and the OTA lane) — a lane that forgets one now fails in seconds
//             instead of shipping a fingerprint nothing matches.
//
//   --audit   FINGERPRINT_ENV is EXACTLY the set of env vars that reach the fingerprint. Evaluates
//             the config once with a unique sentinel in every env var app.config.ts reads and
//             checks which sentinels survive into the hashed projection. Runs on mobile-ci, so a
//             new env var that starts feeding a native/plugin field fails the PR that adds it
//             rather than the release six weeks later. (Also fails the other way: a var that stops
//             reaching the fingerprint should leave this list, or the lanes carry dead
//             requirements.)
//
// See docs/mobile/ota.md and .github/workflows/CLAUDE.md.
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_CONFIG = path.join(PROJECT_ROOT, 'app.config.ts');

/**
 * Env vars whose value reaches the runtimeVersion fingerprint. EVERY lane that evaluates
 * app.config.ts for a shipped artifact must set all of them, to the same values.
 * Kept honest by `--audit`; don't edit by hand without running it.
 */
const FINGERPRINT_ENV = [
  'TRM_GOOGLE_IOS_URL_SCHEME', // google-signin plugin prop (`plugins` is platform-agnostic)
  'TRM_OTA_APP_ID', // updates.requestHeaders['expo-app-id']
  'TRM_OTA_CHANNEL', // updates.requestHeaders['expo-channel-name']
  'TRM_OTA_URL', // updates.url
  'TRM_SERVER_ORIGIN', // ios.associatedDomains + the Android App Links intent filters
];

/**
 * A var is traced by giving it a unique sentinel VALUE and looking for its TOKEN in the hashed
 * config. The two differ because the config transforms some of these before they land:
 * TRM_SERVER_ORIGIN arrives as an origin and leaves as a bare hostname in `associatedDomains`, so
 * matching on the whole value would report it as not reaching the fingerprint when it does.
 * Overrides also exist because some values are validated (or coerced to a Number) as the config
 * evaluates — a bare `sentinel-…` string throws inside the google-signin plugin / `new URL()`
 * instead of being traced. Everything unlisted uses the generated token as its value verbatim.
 */
const SENTINELS = {
  APP_VERSION: { value: '9.87.65', token: '9.87.65' },
  BUILD_NUMBER: { value: '987654321', token: '987654321' },
  TRM_GOOGLE_IOS_URL_SCHEME: { value: 'com.googleusercontent.apps.sentinel-trm-google-ios-url-scheme' },
  TRM_OTA_URL: { value: 'https://sentinel-trm-ota-url.example/manifest' },
  TRM_SERVER_ORIGIN: { value: 'https://sentinel-trm-server-origin.example' },
};

const tokenFor = (name) =>
  SENTINELS[name]?.token ?? `sentinel-${name.toLowerCase().replace(/_/g, '-')}`;
const sentinelFor = (name) => SENTINELS[name]?.value ?? tokenFor(name);

/** Every env var app.config.ts reads — the audit's candidate set, scraped rather than listed. */
function readEnvNames() {
  const source = fs.readFileSync(APP_CONFIG, 'utf8');
  return [...new Set([...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
}

/**
 * The exact JSON @expo/fingerprint hashes as its `expoConfig` source: the config loaded the way
 * ExpoConfigLoader loads it, minus what fingerprint.config.js's sourceSkips drop
 * (ExpoConfigVersions + ExpoConfigExtraSection). Evaluated in a child process so the sentinel env
 * can't leak into this one, and written to a file so a config plugin's warnings on stdout (Sentry's
 * "Missing config for organization, project" is one) can't corrupt the payload.
 */
function fingerprintedConfigJson(env) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trm-fingerprint-env-'));
  const outFile = path.join(tmpDir, 'config.json');
  const loader = `
    const { getConfig } = require('expo/config');
    const { exp } = getConfig(process.cwd(), { skipSDKVersionRequirement: true });
    delete exp._internal;
    delete exp.version;
    delete exp.android?.versionCode;
    delete exp.ios?.buildNumber;
    delete exp.extra;
    require('fs').writeFileSync(process.env.TRM_FINGERPRINT_OUT, JSON.stringify(exp));
  `;
  try {
    execFileSync(process.execPath, ['-e', loader], {
      cwd: PROJECT_ROOT,
      env: { ...env, TRM_FINGERPRINT_OUT: outFile },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    return fs.readFileSync(outFile, 'utf8');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function assert() {
  const missing = FINGERPRINT_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `::error::${missing.join(', ')} not set while evaluating app.config.ts. ` +
        'These feed the OTA runtimeVersion fingerprint, so this lane would bake a placeholder ' +
        'fallback and target a runtime version no other lane ever produces — the update would be ' +
        'published, reported green, and reach no device (issue #62). Add them to this step\'s env.',
    );
    process.exit(1);
  }
  console.log(`fingerprint env OK: ${FINGERPRINT_ENV.join(', ')}`);
}

function audit() {
  const names = readEnvNames();
  // `git` is shelled out to for extra.gitCommit; PATH and friends have to survive.
  const env = { ...process.env };
  for (const name of names) env[name] = sentinelFor(name);

  // A token that isn't a substring of its own sentinel can never match, which would read as
  // "this var doesn't reach the fingerprint" — the exact false negative this gate exists to catch.
  for (const name of names) {
    if (!sentinelFor(name).includes(tokenFor(name))) {
      throw new Error(`SENTINELS.${name}: value must contain its token`);
    }
  }

  const json = fingerprintedConfigJson(env);
  const reaching = names.filter((name) => json.includes(tokenFor(name)));

  const undeclared = reaching.filter((name) => !FINGERPRINT_ENV.includes(name));
  const stale = FINGERPRINT_ENV.filter((name) => !reaching.includes(name));
  if (undeclared.length > 0) {
    console.error(
      `::error::${undeclared.join(', ')} now reach(es) the runtimeVersion fingerprint but ` +
        "is not in FINGERPRINT_ENV. Add it there AND to every lane's env block " +
        '(mobile-android.yml, mobile-ios.yml, mobile-ota.yml), or a lane that omits it will ' +
        'silently ship a binary no published update can match (issue #62).',
    );
  }
  if (stale.length > 0) {
    console.error(
      `::error::${stale.join(', ')} is in FINGERPRINT_ENV but no longer reaches the fingerprint. ` +
        'Drop it from the list so the lanes stop carrying a requirement that buys nothing.',
    );
  }
  if (undeclared.length > 0 || stale.length > 0) process.exit(1);
  console.log(
    `fingerprint env audit OK — ${reaching.length}/${names.length} of app.config.ts's env vars ` +
      `reach the fingerprint: ${reaching.join(', ')}`,
  );
}

const mode = process.argv[2];
if (mode === '--assert') assert();
else if (mode === '--audit') audit();
else {
  console.error('usage: node scripts/fingerprintEnv.js --assert | --audit');
  process.exit(2);
}
