# Social previews (OG cards) + replay visibility — design

Date: 2026-07-03
Status: approved (autonomous session — condensed brainstorm; decisions recorded with rationale)

## Goals

1. **Better social previews.** Links to the site, to a room (`/room/:code`), and to a replay
   (`/replay/:gameId`) should unfurl on Discord/Slack/Telegram/X/Facebook with a real title,
   description, and a **dynamically rendered image** (GitHub-style card), instead of the bare
   `<title>` the SPA shell ships today.
2. **Replay visibility.** Any **seated player** of a finished game can flip its replay between
   **private** (members only — today's behaviour) and **view-by-link** (anyone with the URL).

These interlock: OG endpoints are necessarily unauthenticated (crawlers can't log in), so a
replay's social card must only show real data when its replay is link-visible.

## Context (what exists)

- Production: nginx serves the built SPA; `/api/` + `/ws` proxy to the NestJS server. Every
  page path falls back to a static `index.html` — crawlers see no per-page meta.
- `matchHistory` (Mongo) archives finished games; `GET /api/v1/history/:gameId/replay` is
  auth + membership gated (players/spectators, 404 nondisclosure), hard-gated on
  `status: 'COMPLETED'`.
- Rooms live in Mongo via the lobby module; `RoomView` already carries members, seats, map
  name, and status. The room code in the URL is the joining capability.
- The web router (`store/ui.ts`) currently gates `/replay/:id` behind login.

## Decisions

### D1 — Serve crawler meta via nginx UA routing → server-rendered meta page

Chosen over (a) full SSR of the SPA (massive change for meta tags alone; the app is a
client-rendered game) and (b) a third-party prerender service (new infra, overkill — bots only
need `<head>`).

- `apps/web/nginx.conf` gains a `map $http_user_agent $og_bot` (facebookexternalhit, Twitterbot,
  Discordbot, Slackbot, TelegramBot, WhatsApp, LinkedInBot, …). For `/`, `/room/*`, `/replay/*`,
  bot requests rewrite to `/api/v1/og/page?path=$uri` (existing `/api/` proxy carries it);
  humans keep getting the SPA shell. Assets and other routes are untouched.
- The server's meta page is tiny HTML: `og:title/description/image/url`, `twitter:card=
  summary_large_image`, canonical link, and a meta-refresh to the real path as a safety net for
  odd in-app browsers.
- Absolute URLs derive from `X-Forwarded-Proto` + `Host` (nginx already forwards both), falling
  back to `env.oauthRedirectBase` — no new required env var.
- `index.html` additionally gets static `og:title/og:description` (+`description`) as the
  fallback for crawlers not in the UA map. No static `og:image` — it would need an absolute URL
  unknown at build time.

### D2 — Dynamic PNG cards: hand-authored SVG → `@resvg/resvg-js`

Chosen over satori (extra dep + yoga-wasm + bundled font files; our cards are a fixed layout we
can lay out by hand) and node-canvas (native build pain). resvg ships prebuilt napi binaries and
renders with **system fonts** (`loadSystemFonts`), so Traditional-Chinese text uses
Noto Sans CJK / Microsoft JhengHei rather than a multi-MB font checked into the repo.
`apps/server/Dockerfile` installs `fonts-noto-cjk`. 1200×630. All artwork is original geometric
brand styling (board-like route motifs), consistent with the clean-room rule.

New `apps/server/src/og/` module (controller + service + `card-svg.ts` templates):

- `GET /api/v1/og/page?path=…` → meta HTML (dispatches on `/`, `/room/:code`, `/replay/:id`;
  anything else → generic site meta).
- `GET /api/v1/og/site.png` → brand card.
- `GET /api/v1/og/room/:code.png` → room card: room code, host, seats `n/max`, map name, status.
  Unauthenticated by design — the code in the URL is already the join capability.
- `GET /api/v1/og/replay/:gameId.png` → replay card: map name, date, per-player scores, winner —
  **only when that replay is link-visible**; otherwise the generic site card (also for unknown
  ids — no existence disclosure). Same rule for the meta page's title/description.
- `Cache-Control: public, max-age=300` (rooms change; platforms cache unfurls on their side
  anyway). Text is XML-escaped; long names truncated by CJK-aware width estimate.

### D3 — Replay visibility: `replayVisibility` on `matchHistory`, seated players configure

- `MatchHistoryDoc.replayVisibility?: 'private' | 'link'` — **absent ⇒ 'private'**, preserving
  today's behaviour for every existing archive.
- `PATCH /api/v1/history/:gameId/visibility { visibility }` — allowed for **seated human
  players** of that game (the user's wording: "any player who has ever played"; spectators and
  bots cannot). Non-members get 404, matching the existing nondisclosure stance.
- `GET /api/v1/history/:gameId/replay` moves to an **optional-auth guard** (parses a Bearer
  token when present; anonymous otherwise; a present-but-invalid token still 401s so the web
  client's refresh path works). Access: members (players/spectators) always; otherwise allowed
  iff `replayVisibility === 'link'`; else 404. The `status: 'COMPLETED'` hard gate is unchanged.
- The replay payload gains `visibility` and `canConfigureVisibility` (viewer is a seated player)
  so the UI can render the control without another round-trip.

### D4 — Web: `/replay/:id` becomes visitable while signed out

- `store/ui.ts` no longer forces `/replay/:id` through `/login` — a link-visible replay is
  watchable anonymously. If loading fails (private/unknown) and the visitor is signed out, the
  error card offers "sign in" (with `?redirect=` back to the replay); signed-in users keep the
  existing history/back affordance.
- `ReplayScreen` gains a small "sharing" block in the replay rail (players only): the current
  state, a private ⇄ view-by-link toggle (PATCH), and a copy-link button. zh-Hant + en strings.

## Error handling

- OG endpoints never 500 on missing data: unknown room/replay, private replay, or a render
  failure degrade to the generic site card / meta (log the error; crawlers retry rarely).
- PATCH validates the enum via zod (global pipe); double-PATCH is idempotent.
- Rendering runs on demand (~tens of ms); throttler already rate-limits the API globally.

## Testing

- Server e2e (`og.e2e.spec.ts`): meta page for site/room/replay (title content, image URL,
  escaping); PNG endpoints return `image/png` + PNG magic bytes; **private replay leaks nothing**
  (no player names in HTML/URL space, generic card); link-visible replay shows names.
- Server e2e (extend history spec or new `replay-visibility.e2e.spec.ts`): PATCH by player OK,
  spectator/outsider 404, anonymous replay GET: 404 when private → 200 after a player flips to
  link → 404 again after flipping back.
- Web: ReplayScreen tests for the control (players see it, spectators don't, PATCH called,
  copy-link), ui.test for the un-gated replay route.
- Fonts are environment-dependent, so image tests assert structure (magic bytes, dimensions),
  never pixels.

## Out of scope

- Per-viewer share tokens / expiring links (the game id is already unguessable).
- OG cards for history/maps/tutorial pages (static fallback meta covers them).
- Locale negotiation for cards (cards are bilingual zh-Hant-primary like the app).
