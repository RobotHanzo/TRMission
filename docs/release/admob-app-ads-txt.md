# AdMob `app-ads.txt` verification

AdMob only sells a mobile app's inventory once it has crawled an `app-ads.txt` on the app's
**developer website** and found a line authorising our publisher id. This is the runbook for that
verification (issue #107) — what the repo publishes, and the console-side settings the repo cannot
see, which are where a "we couldn't verify" mail almost always comes from.

## What the repo publishes

| Thing                     | Where                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| The record file           | `apps/web/public/app-ads.txt` → served at `/app-ads.txt` off the web release root             |
| Serving rule              | `apps/web/nginx.conf`, `location = /app-ads.txt` (exact match, `try_files $uri =404`)         |
| Line endings              | pinned to LF in `.gitattributes`                                                              |
| The guard                 | `apps/web/src/config/appAdsTxt.test.ts`                                                       |
| The ids it must authorise | `apps/mobile/app.config.ts` (`ADMOB`) and `apps/web/src/config/adsense.ts` (`ADSENSE.client`) |

Current content — byte-identical to the snippet AdMob hands you in the console:

```
google.com, pub-6497728947722029, DIRECT, f08c47fec0942fa0
```

Two rules the serving side exists to hold:

- **Never answer `/app-ads.txt` with the SPA shell.** Under the plain SPA fallback a missing file
  returns `index.html` at 200, and Google then reports the file as _found but incorrectly
  formatted_ instead of missing — a confusing failure to chase. The exact `location` block 404s
  instead. Same reasoning as the `/.well-known/` and `/assets/` blocks beside it.
- **The published bytes are the record, exactly.** No BOM, LF-terminated, `text/plain`. The test
  asserts the shape and that every `ca-pub-…` / `ca-app-pub-…` id compiled into either client
  resolves to a `pub-…` seller id carried by a `DIRECT google.com` line.

## The console side (not in this repo)

Verified on 2026-08-18 — all green, so a failing verification after this date is one of the
console-side items below, not the file:

- `https://trmission.robothanzo.dev/app-ads.txt` → 200 `text/plain`, no redirect, correct body.
- `https://robothanzo.dev/app-ads.txt` (the root domain) → same, in case the crawler strips the
  subdomain.
- Served identically to `AdsBot-Google`, `Google-Adstxt` and `Googlebot` user agents; `/robots.txt`
  does not disallow it.
- The App Store listing's developer website (`sellerUrl` in the iTunes lookup API for
  `id6790389618`) is `https://trmission.robothanzo.dev/` — the domain the crawler will use.

What is left to check in the AdMob console, in the order that fails most often:

1. **App → App settings → the app-ads.txt developer-website domain matches the store listing**
   exactly (`trmission.robothanzo.dev`). A domain typed by hand here that differs from the store's
   is the literal meaning of "your details don't match the information in your AdMob account".
2. **The AdMob app is linked to its store listing** (App settings → "App store listing"), for the
   right storefront. An unlinked app has no developer website to crawl.
3. **Both AdMob apps** — the iOS and Android entries are separate apps with separate settings, so
   fixing one does not fix the other. Check the Play listing's developer website the same way.
4. Then hit **Check for updates** on the app-ads.txt card. A recrawl takes up to ~24h, and Google
   caches the previous result until it lands.

## Re-verifying by hand

```bash
curl -sSi -A 'AdsBot-Google (+http://www.google.com/adsbot.html)' https://trmission.robothanzo.dev/app-ads.txt
curl -sS "https://itunes.apple.com/lookup?id=6790389618&country=tw" | jq -r '.results[0].sellerUrl'
```

The first must be a 200 `text/plain` with no redirect; the second must be the same host the first
was fetched from.
