# CLAUDE.md

`src/support/` is the public **support form** (issue #80 — Apple guideline 1.5 wants the App Store
Connect Support URL to reach a page where users can actually ask for help) plus the one Discord
webhook that both support requests and in-app star **ratings** are delivered to.

- `GET /support/config` → `{formEnabled}`. The web page reads it and hides the form (leaving the
  e-mail address + Discord invite) on a deployment with no webhook.
- `POST /support` — **deliberately open to anonymous callers.** Someone who cannot sign in is
  exactly the person who most needs support, so a token is optional
  (`OptionalAccessTokenGuard`; a token that is present but bad still 401s) and, when present, the
  account is stamped onto the Discord card. Rate-limited to 10 / 10 min **by source IP** — guards
  run before the validation pipe, so a rejected body spends quota too.

## The webhook is the only inbox

Nothing about a support request is stored in Mongo. That is the whole design, and it decides how
failures are handled:

- **Support**: `SupportNotifier.supportRequest` is awaited and rejects loudly; the controller turns
  that into a **502** so nobody is told "received" about a message that is gone. An unconfigured
  deployment **503**s rather than accepting into a void.
- **Ratings**: already durable in `gameRatings` (and in the dashboard), so `SupportNotifier.rating`
  is fire-and-forget — a webhook outage must never fail a player's submission. Failures go to
  Sentry under the `support.webhook` tag.

`allowed_mentions: {parse: []}` on every send is a **security control, not a nicety**: every field
carries user-supplied text, and without it an `@everyone` typed into the form would ping the whole
server from a webhook nobody can mute.

`DISCORD_WEBHOOK` is the network seam (`FetchDiscordWebhook` in production, `FakeDiscordWebhook` in
e2e), and `SupportConfig` follows the `AuthConfig` pattern — env-derived, `.useValue`-overridable
from specs.

## Env vars

`SUPPORT_DISCORD_WEBHOOK_URL` — the maintainers' Discord webhook. Unset ⇒ the form reports itself
unavailable and rating notifications are skipped; everything else is unaffected.
