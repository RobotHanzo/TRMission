// Load-bearing Hermes runtime shims — imported FIRST from index.ts, before any protobuf/i18n use.
// In the jest/Node test environment these APIs already exist; every polyfill here self-guards
// (installs only when the global is missing), so on Node these imports are no-ops and only take
// effect on the Hermes device runtime.

// i18next zh/en plural selection needs a spec-complete Intl.PluralRules. Hermes ships an incomplete
// Intl, so install the polyfill (it no-ops when native PluralRules is present) plus our two locales.
//
// ORDER IS LOAD-BEARING: intl-pluralrules' feature-detection (shouldPolyfill) AND its runtime locale
// resolution both route through @formatjs/intl-localematcher's best-fit matcher, which does
// `new Intl.Locale(…).maximize()`. Hermes ships NO Intl.Locale, so that throws at boot
// ("undefined cannot be used as a constructor") before any screen renders. Polyfill
// getCanonicalLocales + Locale FIRST so the matcher has a real constructor. All three self-guard
// (no-op when the native API is present), so on Node/jest — which has full Intl — these are no-ops.
// The `.js` subpaths are required: intl-getcanonicallocales/intl-locale only expose `./polyfill.js`
// in their exports map (intl-pluralrules exposes the extensionless `./polyfill`).
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-pluralrules/locale-data/zh';

// protobuf-es's binary codec lazily constructs `new TextEncoder()`, `new TextDecoder()`, and
// `new TextDecoder("utf-8", { fatal: true })` off globalThis (see @bufbuild/protobuf wire/
// text-encoding). Hermes ships TextEncoder but not a spec TextDecoder. fast-text-encoding fills the
// gap and self-guards (`scope.TextDecoder = scope.TextDecoder || …`), so it never clobbers a native.
import 'fast-text-encoding';
