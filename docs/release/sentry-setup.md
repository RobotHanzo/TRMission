# Sentry setup (errors, tracing, session replay)

One-time human setup for the error/performance monitoring added in issue #44. It covers all four
surfaces — `apps/server`, `apps/web`, `apps/admin`, `apps/mobile`.

**None of this is required.** Every surface is gated on a DSN: with none configured, `Sentry.init`
is never called, nothing is sent, and the two Vite bundles don't even ship the SDK. You can run,
develop, test and self-host TRMission without a Sentry account, and CI stays green either way. Do
this only when you want production error reports.

Sentry's free Developer plan is single-user with modest monthly quotas, which is comfortably enough
for a project this size given the sampling defaults in §7 — check their current pricing page for
the exact allowances, they change. Sentry is also self-hostable if you'd rather not use their
cloud; the setup below is identical apart from the URLs. Between those two facts it fits the
"no _paid_ SaaS" rule in `apps/mobile/CLAUDE.md`.

Read **§8 (what is never sent)** before you point real users at this. TRMission is a
hidden-information game, and the redaction contract is the reason it's safe to collect crash
reports from live matches at all.

---

## 1. Create the org and four projects

Sign up at [sentry.io](https://sentry.io) (or stand up self-hosted Sentry) and create one
organization. Note its **slug** — the short name in the URL, e.g. `sentry.io/organizations/<slug>/`.
That slug is `SENTRY_ORG` everywhere below.

Create **four** projects. One per surface, because they have different owners, volumes and alerting
needs, and because source maps are uploaded per project — a shared project would mean one app's
maps never match the other's stack traces.

| Project slug (suggested) | Sentry platform      | Surface                            |
| ------------------------ | -------------------- | ---------------------------------- |
| `trmission-server`       | Node.js → **NestJS** | `apps/server`                      |
| `trmission-web`          | Browser → **React**  | `apps/web`                         |
| `trmission-admin`        | Browser → **React**  | `apps/admin` (served at `/admin/`) |
| `trmission-mobile`       | **React Native**     | `apps/mobile`                      |

Slugs are yours to choose; the values just have to match what you set in §3–§6. Skip every
"install the SDK" wizard step Sentry shows you — the code is already written and wired.

## 2. Collect the four DSNs

For each project: **Settings → Projects → _project_ → Client Keys (DSN)**, copy the DSN.

A DSN is an ingest endpoint, **not a credential**. It is meant to ship inside a public web bundle
and a downloadable app binary, and that's exactly what happens here. Do not treat it as a secret,
and do not try to hide it — the only thing it lets an outsider do is send you junk events, which is
what Sentry's per-key rate limits and inbound filters exist for.

## 3. Auth token for source maps (optional, strongly recommended)

Without this you still get errors, but web/mobile stack traces point at minified bundle offsets
instead of real files and line numbers — which in practice means you can't act on them.

**Settings → Developer Settings → Auth Tokens → Create New Token**, with scopes:

- `project:releases` — create releases and upload artifacts
- `org:read` — resolve the org slug

One token covering all four projects is fine. This one **is** a real secret. It is used only inside
build steps, never baked into any artifact:

- web/admin — passed to `docker build` as a **BuildKit secret** (`sentry_auth_token`), not a build
  arg, because a build arg is recorded in the stage's layer metadata and this repo pushes its layer
  cache to a public GHCR tag.
- mobile — an env var on the native build / OTA publish steps, consumed by the Sentry Gradle plugin
  and Xcode build phase.

The server needs no token at all: it runs TypeScript through `@swc-node/register`, so its stack
traces are already source-accurate with nothing to upload.

## 4. Server (`apps/server`)

Runtime environment variables — no rebuild needed, just restart. Full reference in
`apps/server/.env.example`.

| Variable                    | Required | Meaning                                                        |
| --------------------------- | -------- | -------------------------------------------------------------- |
| `SENTRY_DSN`                | yes      | `trmission-server`'s DSN. Unset ⇒ everything below is ignored. |
| `SENTRY_ENVIRONMENT`        | no       | Environment tag. Defaults to `NODE_ENV`, else `development`.   |
| `SENTRY_TRACES_SAMPLE_RATE` | no       | Fraction of requests traced, `0`–`1`. Default `0.1`. See §7.   |

For the Docker deployments these are already plumbed through `docker-compose.yml` and
`docker-stack.yml` — set them in your `.env` / Portainer stack environment.

The release is stamped from `GIT_COMMIT`, which CI already bakes into the image, so Sentry events
tie back to a commit with no extra wiring.

**Verify:** start the server and look for `[sentry] error reporting + tracing enabled` on the very
first line of output — it prints before Nest boots, because Sentry is initialised from
`apps/server/instrument.mjs` as the process's first `--import`. No line means no DSN was seen.

## 5. Web + admin (`apps/web`, `apps/admin`)

Both are static bundles, so their config is **baked at build time** — changing a DSN means
rebuilding the image, not restarting a container.

### Via GitHub Actions (`docker-build.yml`)

Repo **variables** (Settings → Secrets and variables → Actions → Variables):

| Variable                          | Meaning                                         |
| --------------------------------- | ----------------------------------------------- |
| `WEB_SENTRY_DSN`                  | `trmission-web`'s DSN                           |
| `ADMIN_SENTRY_DSN`                | `trmission-admin`'s DSN                         |
| `SENTRY_ENVIRONMENT`              | e.g. `production`                               |
| `SENTRY_ORG`                      | org slug                                        |
| `SENTRY_WEB_PROJECT`              | e.g. `trmission-web` (source-map upload target) |
| `SENTRY_ADMIN_PROJECT`            | e.g. `trmission-admin`                          |
| `SENTRY_TRACES_SAMPLE_RATE`       | optional, default `0.1`                         |
| `SENTRY_REPLAY_SAMPLE_RATE`       | optional, default `0` — see §7                  |
| `SENTRY_REPLAY_ERROR_SAMPLE_RATE` | optional, default `1`                           |

Repo **secret**: `SENTRY_AUTH_TOKEN`.

### Building the image by hand

```bash
docker build -f apps/web/Dockerfile . \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)" \
  --build-arg SENTRY_DSN='https://…@…ingest.sentry.io/…' \
  --build-arg ADMIN_SENTRY_DSN='https://…@…ingest.sentry.io/…' \
  --build-arg SENTRY_ENVIRONMENT=production \
  --build-arg SENTRY_ORG=<org-slug> \
  --build-arg SENTRY_PROJECT=trmission-web \
  --build-arg SENTRY_ADMIN_PROJECT=trmission-admin \
  --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN
```

`docker compose --profile full up --build` reads the same values from your shell/`.env` as
`WEB_SENTRY_DSN`, `ADMIN_SENTRY_DSN`, `SENTRY_ENVIRONMENT` and the three sample rates.

### Running the dev server against Sentry

Rarely useful, but: put `VITE_SENTRY_DSN=…` in `apps/web/.env.local`. Prefer a **separate**
`development` environment or project so local noise never lands in your production issue stream.

**Verify:** load the app, open DevTools → Network, and look for a request to `…ingest.sentry.io`.

A quicker build-side check, since the DSN decides whether the SDK is bundled at all:

```bash
grep -rl sentry apps/web/dist/assets/    # DSN set  → matches the ~280 kB SDK chunk
                                         # DSN unset → matches nothing
```

A DSN-less build still emits a ~30-byte `sentry-*.js` stub (the named chunk with its contents
tree-shaken away), so judge by size or by that grep, not by the filename.

## 6. Mobile (`apps/mobile`)

Two independent halves: **runtime config** (which DSN the app reports to) and **build-time upload**
(making those reports readable).

Repo **variables**:

| Variable                              | Meaning                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `TRM_SENTRY_DSN`                      | `trmission-mobile`'s DSN. Unset ⇒ the SDK is never initialised. |
| `TRM_SENTRY_ENVIRONMENT`              | e.g. `production`                                               |
| `TRM_SENTRY_TRACES_SAMPLE_RATE`       | optional, default `0.1`                                         |
| `TRM_SENTRY_REPLAY_SAMPLE_RATE`       | optional, default `0` — **leave at 0**, see §9                  |
| `TRM_SENTRY_REPLAY_ERROR_SAMPLE_RATE` | optional, default `0` — **leave at 0**, see §9                  |
| `SENTRY_ORG`                          | org slug (shared with the web lane)                             |
| `SENTRY_MOBILE_PROJECT`               | e.g. `trmission-mobile`                                         |

Repo **secret**: `SENTRY_AUTH_TOKEN` (shared). When it is absent the lanes set
`SENTRY_DISABLE_AUTO_UPLOAD=true`, so the upload build phase the config plugin injects can't fail a
build for anyone without a Sentry account.

Three things about mobile specifically:

1. **The `TRM_SENTRY_*` variables must be set on the OTA lane too**, not just the store lanes. An
   applied OTA update's manifest **replaces** the binary's `Constants.expoConfig.extra` — publishing
   an update without them would strip the DSN off every device that takes it. This is the same
   lockstep rule the Google client ids already live under; all three lanes
   (`mobile-android.yml`, `mobile-ios.yml`, `mobile-ota.yml`) already read them.
2. **Adding the Sentry SDK changed the OTA `runtimeVersion` fingerprint.** If you are configuring
   this on an app that already shipped, publish a **fresh native build to both stores first** —
   until a binary carrying the new fingerprint is installed, no OTA will match it
   (`docs/mobile/ota.md`).
3. **`sentry.properties` is not committed.** The config plugin is deliberately passed no
   organization/project props so the plugin entry — and therefore the fingerprint — is identical
   whether or not an operator has a Sentry account. Everything comes from the environment at build
   time. Don't "helpfully" move org/project into `app.config.ts`; it would make the runtime version
   depend on who is building.

**Verify:** install the build and just launch it. The React Native SDK starts a session on launch,
so the release should show up under **Releases** in the `trmission-mobile` project within a minute
or two — that confirms the DSN is live without having to crash anything. To also prove symbolication
works, add a temporary `throw` behind a debug-only control and check the resulting event's stack
shows real file and line numbers rather than bundle offsets.

Note the app **also** keeps its own local crash record (`app/crashCapture.ts` → AsyncStorage), which
surfaces as a share row in Settings once a crash has been recorded. That is the offline fallback and
works with no Sentry at all, so seeing it does **not** prove Sentry is configured.

## 7. Sampling and quota

Defaults are deliberately conservative — a chatty tracing config will burn a free-tier quota in
days, and traces are the cheapest thing to over-collect by accident.

| Signal             | Default                    | Notes                                                                                             |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------- |
| Errors             | always on                  | The signal you actually want.                                                                     |
| Tracing            | `0.1` on every surface     | Server drops `/metrics` and `/healthz` outright — they poll forever and would otherwise dominate. |
| Web session replay | `0` ordinary, `1` on error | You only get a replay when something actually broke.                                              |
| Mobile replay      | `0` / `0` — **off**        | See §9.                                                                                           |

Values out of `[0, 1]`, blank, or unparseable fall back to the default rather than silently
disabling sampling (`telemetrySampleRate` in `@trm/shared`). Raise tracing only when you're chasing
a specific latency question, and put it back afterwards.

## 8. What is never sent (read this one)

TRMission is a hidden-information game. A player's hand, their kept missions, the draw-deck order
and the RNG seed are secrets the server exists to withhold — and a maintainer reading a crash report
from a **live** match may be sitting at that same table. So telemetry is treated as the second
egress path alongside the wire, and gets the same structural guard.

- `packages/shared/src/telemetry.ts` is the **single denylist**, run from every surface's
  `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`. It drops values by key name (hands,
  kept/offered missions, deck, discard, ticket decks, `rng`, `seed`, `selfView`, tokens, tickets,
  cookies, passwords, emails, IPs), strips sensitive query parameters from URLs, and redacts JWTs /
  bearer credentials / email addresses found in free text. It is depth-, breadth- and cycle-bounded.
- `sendDefaultPii: false` everywhere, so the SDKs never attach IPs, cookies or request bodies on
  their own initiative.
- The only identifier attached to an event is the **server-minted account id** — never a display
  name, email or IP.
- Web Session Replay `block`s the hand and mission trays outright via `SECRET_CLASS`
  (`apps/web/src/observability/secrets.ts`). Text masking is not enough there: the secret is the
  card _colours_ and route shapes, which survive text masking.
- The server's hidden-information egress guard reports at `fatal` with **only** the two seat ids —
  attaching the snapshot would commit the very leak the guard just blocked.

**If you add UI that renders the viewer's hand or missions, it must carry `SECRET_CLASS`. If you add
a secret field to `GameState`/`SelfView`, add its key name to `telemetry.ts`.** Both rules are
covered by tests in `packages/shared/src/telemetry.test.ts`.

## 9. Mobile Session Replay — off, and why

Both mobile replay rates default to `0` and the two repo variables exist only so you can turn them
on deliberately.

Mobile Session Replay records **the screen**, and on this game the screen includes the player's own
hand and missions. The integration is wired with maximal masking (`maskAllText`, `maskAllImages`,
`maskAllVectors`), but the board renders through a **single Skia native view**, and whether that
view is masked or captured has not been verified on a real device.

Before raising either rate: install a build with replay on, play a hand, and inspect the resulting
replay in Sentry. If the board or the hand tray is legible, leave it off.

Web replay does not carry this caveat — it records the DOM, where the secret elements are blocked
individually and verifiably.

## 10. Recommended alerts

Worth creating once, in the `trmission-server` project:

- **Any event tagged `trm.site:hub.leak_blocked`** → page immediately. This is the
  hidden-information egress guard firing, and it should be at zero forever. Its Prometheus twin is
  `trm_security_leak_blocked_total`.
- **`trm.site:hub.bot_driver_stalled`** → a match may be stuck waiting on a turn nothing will
  prompt again.
- **`trm.site:hub.recovery_failed`** → a persisted game can no longer be resumed; affected players
  have lost access to it.
- **`trm.site:ws.receive`** → an inbound frame threw somewhere unexpected. Each one is a bug.

## Troubleshooting

**No events at all from web/admin.** Check the built bundle actually contains the SDK:
`grep -rl sentry apps/web/dist/assets/` (see §5). No match means the DSN wasn't set at _build_ time —
these are static bundles, so setting a runtime environment variable on the container does nothing.
Rebuild the image.

**Events arrive but stack traces are minified.** Source maps weren't uploaded. Confirm
`SENTRY_AUTH_TOKEN` reached the build, and that the `release` matches: the bundle stamps
`VITE_COMMIT_HASH`, and `vite.config.ts` uploads under the same value. A mismatch uploads maps that
bind to nothing.

**Admin events landing in the web project.** `ADMIN_SENTRY_DSN` isn't set, so the admin bundle
inherits nothing and stays silent (or, if you wired them to one DSN by hand, both report to one
project while maps upload to two). Set both DSNs.

**Server starts but never prints `[sentry] …`.** `SENTRY_DSN` isn't visible to the process. Note the
server reads it via `apps/server/instrument.mjs` **before** Nest boots, so a config layer that only
populates env later won't work.

**Server events have no HTTP/Mongo spans.** Something changed the `--import` wiring. Sentry must be
the process's first `--import` (`node --import ./instrument.mjs src/main.ts`); under ESM the whole
module graph is linked before it evaluates, so an `import` inside `main.ts` loses the race against
`node:http` and produces no spans. See `apps/server/CLAUDE.md`.

**Mobile reports arrive but aren't symbolicated.** The release must match: the app stamps
`version+buildNumber`, so `APP_VERSION` and `BUILD_NUMBER` have to be the same in the build step
that uploads maps as in the one that bundles JS. Both lanes derive them from the `v<semver>+<build>`
tag (`docs/release/mobile-versioning.md`).

**An OTA update silently turned reporting off.** The `TRM_SENTRY_*` variables weren't set on
`mobile-ota.yml`. An applied update's manifest replaces `extra` wholesale — republish with them set.

## Related

- `apps/server/CLAUDE.md` — the `--import` ordering, the `ErrorReporter` port, server env vars
- `apps/web/CLAUDE.md` — the lazy-load façade and `SECRET_CLASS`
- `apps/admin/CLAUDE.md` — dashboard masking posture
- `apps/mobile/CLAUDE.md` — SDK vs. the local `crashCapture` fallback, replay caveat
- `.github/workflows/CLAUDE.md` — the full CI variable/secret inventory
- `docs/mobile/ota.md` — fingerprint impact and the lockstep rule
- `docs/plans/2026-07-25-sentry-integration.md` — the design decisions behind all of the above
