#!/usr/bin/env node
/**
 * Generates `play-data-safety.csv` — the upload-ready answers for Play Console's Data safety form
 * (App content → Data safety → Import from CSV).
 *
 * Play's importer wants ITS OWN row set, in its own order, keyed by machine-readable question and
 * response ids. So this does not author a CSV: it takes Google's own file and stamps the ANSWERS
 * below onto the `Response value` column, leaving every other byte untouched.
 *
 *   node docs/release/play-data-safety.mjs [path-to-input.csv]
 *
 * The default input is `data_safety_sample.csv` — Google's sample, committed next to this script so
 * a regeneration needs nothing outside the repo. An export of our own answers (Play Console → Data
 * safety → Export to CSV) has the identical row set and works just as well; pass it when Play adds
 * a question, and re-commit it as the new input.
 *
 * Two properties are ASSERTED before anything is written, because a file the importer rejects is
 * worse than no file: the input must round-trip through this script's own CSV reader/writer, and
 * the output must not introduce a single quoted cell that the input did not already have (every
 * answer below is therefore free of commas and quotes — see `assertNoNewQuoting`).
 *
 * WHY each answer is what it is — the mapping from these ids back to the code that collects the
 * data — is `play-data-safety.md`. Change one, change the other, and keep both in lockstep with
 * `app-store-connect-setup.md` §11 (Apple's table) and `apps/web/src/screens/PrivacyScreen.tsx`
 * (the published policy). A store-to-store mismatch is a review flag.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = resolve(HERE, 'data_safety_sample.csv');
const OUT = resolve(HERE, 'play-data-safety.csv');
const MINIMAL_OUT = resolve(HERE, 'play-data-safety-minimal.csv');
const DELETION_URL = 'https://trmission.robothanzo.dev/account/delete';

// ---------------------------------------------------------------------------------------------
// App-level answers. Key is `QUESTION_ID` for a free-text/boolean question, `QUESTION_ID:RESPONSE_ID`
// for a choice. Anything not listed is left blank — which is the correct answer for every
// unselected checkbox and for the OPTIONAL badges we do not opt into.
// ---------------------------------------------------------------------------------------------
/**
 * The two overview booleans. Google's sample answers exactly these at the app level and nothing
 * else, so this is the part of the form the sample proves is importable.
 *
 * Deliberately blank (all OPTIONAL, none apply): PSL_DATA_COLLECTION_COMPLIES_FAMILY_POLICY — the
 * app is not designed for children and declaring otherwise pulls AdMob into the Families
 * certified-SDK list; PSL_INDEPENDENTLY_VALIDATED — no MASA review; PSL_UPI_BADGE_OPT_IN — no UPI
 * payments.
 */
const OVERVIEW = {
  PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA: 'true',
  // HTTPS + WSS only; the refresh token additionally lives in the OS keystore.
  PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT: 'true',
};

/**
 * Account creation, deletion and outside-app sign-in. Google's sample leaves every one of these
 * blank, so unlike everything else here they are not demonstrated to import — `--minimal` drops
 * them wholesale, which is the first thing to try if Play refuses the full file. They are five
 * questions to answer by hand in the Console if it comes to that.
 *
 * Free text is kept comma-free, quote-free and short: `assertNoNewQuoting` enforces the first two,
 * and Play caps these fields (the limit is undocumented, so stay well under 100 characters).
 */
const ACCOUNT_QUESTIONS = {
  // Five sign-in methods: guest, email+password, Google, Apple, Discord.
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS:PSL_ACM_USER_ID_PASSWORD': 'true',
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS:PSL_ACM_OAUTH': 'true',
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS:PSL_ACM_OTHER': 'true',
  PSL_ACM_SPECIFY: 'Anonymous guest accounts created with no credentials',

  'PSL_SUPPORT_DATA_DELETION_BY_USER:DATA_DELETION_YES': 'true',
  PSL_ACCOUNT_DELETION_URL: DELETION_URL,
  PSL_DATA_DELETION_URL: DELETION_URL,

  // Users sign in with Google/Apple/Discord accounts they already hold, and with TRMission
  // accounts created on the browser version of the same game — both created outside this app.
  PSL_HAS_OUTSIDE_APP_ACCOUNTS: 'true',
  'PSL_OUTSIDE_APP_ACCOUNT_TYPES:PSL_OUTSIDE_APP_ACCOUNT_TYPE_OTHER': 'true',
  PSL_OUTSIDE_APP_ACCOUNT_TYPE_SPECIFY: 'Existing Google / Apple / Discord or web account',
};

// ---------------------------------------------------------------------------------------------
// The declared data types, keyed by Play's response id. A type absent here is declared "not
// collected" — the whole of its 19-row usage block stays blank, which is what the Console expects.
//
// `shared` follows Play's definition (transferred to a third party). AdMob is Google's own ad
// business, not a processor acting for us; Sentry is declared shared per app-store-connect-setup.md
// §11, which is a decision rather than a fact — see play-data-safety.md.
// ---------------------------------------------------------------------------------------------
const F = 'PSL_APP_FUNCTIONALITY';
const A = 'PSL_ANALYTICS';
const ADV = 'PSL_ADVERTISING';
const SEC = 'PSL_FRAUD_PREVENTION_SECURITY';
const ACC = 'PSL_ACCOUNT_MANAGEMENT';

const DECLARED = {
  // Personal info
  PSL_EMAIL: { shared: false, required: false, collect: [F, ACC] },
  PSL_USER_ACCOUNT: { shared: false, required: true, collect: [F, ACC, SEC] },
  PSL_OTHER_PERSONAL: { shared: false, required: true, collect: [SEC] },
  // Location — AdMob's IP-derived coarse location only; the app asks for no location permission.
  PSL_APPROX_LOCATION: { shared: true, required: true, collect: [ADV], share: [ADV] },
  // Messages
  PSL_OTHER_MESSAGES: { shared: false, required: false, collect: [F] },
  // App info and performance
  PSL_CRASH_LOGS: { shared: true, required: true, collect: [F], share: [F] },
  PSL_PERFORMANCE_DIAGNOSTICS: { shared: true, required: true, collect: [F], share: [F] },
  // App activity
  PSL_USER_INTERACTION: { shared: true, required: true, collect: [F, ADV, A], share: [ADV, A] },
  PSL_USER_GENERATED_CONTENT: { shared: false, required: false, collect: [F, SEC] },
  PSL_OTHER_APP_ACTIVITY: { shared: false, required: true, collect: [F] },
  // Identifiers
  PSL_DEVICE_ID: { shared: true, required: true, collect: [ADV, A, F], share: [ADV, A] },
};

/** The data-types checklist question each declared type is ticked in. */
const TYPE_CHECKLIST = {
  PSL_EMAIL: 'PSL_DATA_TYPES_PERSONAL',
  PSL_USER_ACCOUNT: 'PSL_DATA_TYPES_PERSONAL',
  PSL_OTHER_PERSONAL: 'PSL_DATA_TYPES_PERSONAL',
  PSL_APPROX_LOCATION: 'PSL_DATA_TYPES_LOCATION',
  PSL_OTHER_MESSAGES: 'PSL_DATA_TYPES_EMAIL_AND_TEXT',
  PSL_CRASH_LOGS: 'PSL_DATA_TYPES_APP_PERFORMANCE',
  PSL_PERFORMANCE_DIAGNOSTICS: 'PSL_DATA_TYPES_APP_PERFORMANCE',
  PSL_USER_INTERACTION: 'PSL_DATA_TYPES_APP_ACTIVITY',
  PSL_USER_GENERATED_CONTENT: 'PSL_DATA_TYPES_APP_ACTIVITY',
  PSL_OTHER_APP_ACTIVITY: 'PSL_DATA_TYPES_APP_ACTIVITY',
  PSL_DEVICE_ID: 'PSL_DATA_TYPES_IDENTIFIERS',
};

/** Expand DECLARED into the flat `question[:response]` → value map the transformer applies. */
function buildAnswers({ minimal }) {
  const out = { ...OVERVIEW, ...(minimal ? {} : ACCOUNT_QUESTIONS) };
  for (const [type, d] of Object.entries(DECLARED)) {
    out[`${TYPE_CHECKLIST[type]}:${type}`] = 'true';
    const q = `PSL_DATA_USAGE_RESPONSES:${type}`;
    out[`${q}:PSL_DATA_USAGE_COLLECTION_AND_SHARING:PSL_DATA_USAGE_ONLY_COLLECTED`] = 'true';
    if (d.shared)
      out[`${q}:PSL_DATA_USAGE_COLLECTION_AND_SHARING:PSL_DATA_USAGE_ONLY_SHARED`] = 'true';
    // Nothing we collect is discarded within the same session, so this is uniformly false.
    out[`${q}:PSL_DATA_USAGE_EPHEMERAL`] = 'false';
    out[
      `${q}:DATA_USAGE_USER_CONTROL:${
        d.required ? 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED' : 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL'
      }`
    ] = 'true';
    for (const p of d.collect) out[`${q}:DATA_USAGE_COLLECTION_PURPOSE:${p}`] = 'true';
    for (const p of d.share ?? []) out[`${q}:DATA_USAGE_SHARING_PURPOSE:${p}`] = 'true';
  }
  return out;
}

// --- CSV ---------------------------------------------------------------------------------------
// Play emits CRLF, no BOM, no trailing newline, and quotes a field only when it contains a comma
// or a quote. `main` asserts this round-trips the input byte-for-byte before trusting it to write.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else if (ch === '\n') {
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

const writeCsv = (rows) =>
  rows
    .map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\r\n');

/**
 * Every line of the output must differ from the input ONLY inside the third cell, and must not have
 * gained a quote doing it. Google's file never quotes a Response value, so a quoted one is the one
 * shape we cannot prove their importer accepts — refuse to emit it rather than find out at upload.
 */
function assertNoNewQuoting(src, before, after) {
  const inputLines = before.split('\r\n');
  const quotes = (line) => (line.match(/"/g) ?? []).length;
  const bad = after
    .split('\r\n')
    .map((line, i) => ({ line, n: i + 1, gained: quotes(line) > quotes(inputLines[i]) }))
    .filter((r) => r.gained);
  if (bad.length) {
    throw new Error(
      `these output lines quote a cell that ${src} did not — remove commas and quotes from the ` +
        `answers that produced them:\n  ${bad.map((r) => `${r.n}: ${r.line}`).join('\n  ')}`,
    );
  }
}

// --- main --------------------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const minimal = argv.includes('--minimal');
  const src = argv.find((a) => !a.startsWith('--')) ?? DEFAULT_INPUT;
  const out_ = minimal ? MINIMAL_OUT : OUT;
  const raw = readFileSync(src, 'utf8');
  const rows = parseCsv(raw);

  if (writeCsv(rows) !== raw) {
    throw new Error(
      `${src} does not round-trip through this script's CSV reader/writer — Play changed its ` +
        `format, so the writer must be re-checked before the output can be trusted.`,
    );
  }
  const [header, ...body] = rows;
  if (header[0] !== 'Question ID (machine readable)' || header[2] !== 'Response value') {
    throw new Error(`unexpected header in ${src}: ${header.join(',')}`);
  }

  const answers = buildAnswers({ minimal });
  const used = new Set();
  let changed = 0;
  for (const row of body) {
    const key = row[1] ? `${row[0]}:${row[1]}` : row[0];
    used.add(key);
    const value = answers[key] ?? '';
    if (row[2] !== value) changed++;
    row[2] = value;
  }

  // A key the input has no row for means Play renamed or dropped a question — never silent.
  const orphans = Object.keys(answers).filter((k) => !used.has(k));
  if (orphans.length) {
    throw new Error(`answers reference ids absent from ${src}:\n  ${orphans.join('\n  ')}`);
  }

  const text = writeCsv(rows);
  assertNoNewQuoting(src, raw, text);
  writeFileSync(out_, text, 'utf8');

  const declared = body.filter((r) => r[0].startsWith('PSL_DATA_TYPES_') && r[2] === 'true');
  console.log(`wrote ${out_}${minimal ? '  (--minimal: account questions left blank)' : ''}`);
  console.log(`  from ${src}`);
  console.log(`  ${body.length} rows, ${changed} response values changed, 0 cells newly quoted`);
  console.log(`  ${declared.length} data types declared: ${declared.map((r) => r[1]).join(', ')}`);
}

main();
