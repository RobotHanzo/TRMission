// `public/app-ads.txt` is the IAB record AdMob crawls off the deployed web root to decide whether
// this publisher may sell the mobile app's ad inventory (issue #107). Google finds it via the
// *developer website* on the store listing, so it is published from here — apps/web owns that
// origin — even though the inventory it authorises is `apps/mobile`'s AdMob placements.
//
// The failure this guards is a quiet one: the crawler reports "found, but your details don't match
// your AdMob account", which is what a publisher id that drifted from the ids compiled into the
// clients looks like from Google's side. So assert the record's shape and that every `ca-pub-…` /
// `ca-app-pub-…` id shipped by either client is covered by a DIRECT line in it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADSENSE } from './adsense';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, '..', '..', ...p), 'utf8');

const raw = read('public', 'app-ads.txt');

/** One data record: `<ad system domain>, <publisher id>, <DIRECT|RESELLER>[, <cert authority id>]`. */
interface AdsTxtRecord {
  system: string;
  sellerId: string;
  relationship: string;
  certId: string | undefined;
}

const records: AdsTxtRecord[] = raw
  .split('\n')
  .map((l) => l.replace(/#.*$/, '').trim())
  .filter(Boolean)
  .map((l) => {
    const [system, sellerId, relationship, certId] = l.split(',').map((f) => f.trim());
    return { system: system!, sellerId: sellerId!, relationship: relationship!, certId };
  });

/** `ca-pub-1234` (AdSense) and `ca-app-pub-1234~5678` / `ca-app-pub-1234/5678` (AdMob) all name the
 *  same account as the `pub-1234` seller id an app-ads.txt line carries. */
function sellerIdOf(googleId: string): string | undefined {
  return /^ca-(?:app-)?(pub-\d+)[~/]?/.exec(googleId)?.[1];
}

describe('app-ads.txt', () => {
  it('is a well-formed IAB record file', () => {
    expect(
      raw.charCodeAt(0),
      'no UTF-8 BOM — crawlers read the BOM as part of the first field',
    ).not.toBe(0xfeff);
    expect(raw.endsWith('\n'), 'final record is newline-terminated').toBe(true);
    expect(raw.includes('\r'), 'LF only (pinned in .gitattributes)').toBe(false);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(r.system).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(r.sellerId).toMatch(/^pub-\d+$/);
      expect(r.relationship).toMatch(/^(DIRECT|RESELLER)$/);
      if (r.certId !== undefined) expect(r.certId).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('covers every Google publisher id the two clients ship', () => {
    // apps/mobile's AdMob ids are checked-in literals in its Expo config (they feed the OTA
    // fingerprint, so they cannot be env vars) — read them as text rather than importing a module
    // that would pull in Expo.
    const mobileConfig = read('..', 'mobile', 'app.config.ts');
    const shipped = new Set(
      [...mobileConfig.matchAll(/ca-app-pub-[\d~/]+/g)]
        .map((m) => m[0])
        .concat(ADSENSE.client || [])
        .map(sellerIdOf)
        .filter((id): id is string => Boolean(id)),
    );
    expect(shipped.size, 'found the clients’ Google ad ids').toBeGreaterThan(0);

    const direct = new Set(
      records
        .filter((r) => r.system === 'google.com' && r.relationship === 'DIRECT')
        .map((r) => r.sellerId),
    );
    for (const sellerId of shipped) {
      expect(
        direct.has(sellerId),
        `app-ads.txt must carry a DIRECT google.com line for ${sellerId} — AdMob/AdSense verification fails without it`,
      ).toBe(true);
    }
  });
});
