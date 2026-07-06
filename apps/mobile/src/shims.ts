// Load-bearing Hermes runtime shims — imported FIRST from index.ts, before any protobuf/i18n use.
// In the jest/Node test environment these APIs already exist; every polyfill here self-guards
// (installs only when the global is missing), so on Node these imports are no-ops and only take
// effect on the Hermes device runtime.

// i18next zh/en plural selection needs a spec-complete Intl.PluralRules. Hermes ships an incomplete
// Intl, so install the polyfill (it no-ops when native PluralRules is present) plus our two locales.
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-pluralrules/locale-data/zh';

// protobuf-es's binary codec lazily constructs `new TextEncoder()`, `new TextDecoder()`, and
// `new TextDecoder("utf-8", { fatal: true })` off globalThis (see @bufbuild/protobuf wire/
// text-encoding). Hermes ships TextEncoder but not a spec TextDecoder. fast-text-encoding fills the
// gap and self-guards (`scope.TextDecoder = scope.TextDecoder || …`), so it never clobbers a native.
import 'fast-text-encoding';
