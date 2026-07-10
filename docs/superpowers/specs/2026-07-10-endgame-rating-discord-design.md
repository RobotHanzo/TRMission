# End-game star rating + Discord CTA — design

## Goal

The post-game `ScoreBoard` (`apps/web/src/components/ScoreBoard.tsx`) currently ends with a
rematch-vote row and an actions row (inspect map / leave game) — no path for a player to say how
they liked the game, and no invitation to the community. Add:

1. A five-star rating widget (larger than the scoreboard's existing 13–15px icon glyphs) + submit
   button, capturing an "overall app experience" rating (not a per-match review) but tagged with
   the `gameId`/`roomId` it was submitted from, for later correlation.
2. A Discord-join button, visually identical to the one already on `WelcomeScreen.tsx`, always
   visible on the end-game screen.
3. A minimal maintainer-dashboard page to read back submitted ratings.

No rating infrastructure exists anywhere in the codebase today (verified — no `rating`/`feedback`
matches in `apps/web` or `apps/server`), so this is a new small vertical slice: Mongo collection →
REST endpoint → client widget, plus a dashboard read surface.

## Data model & API (`apps/server`, new `src/ratings/` module)

**`gameRatings` collection** — append-only (every submission is a new document; ratings are never
overwritten or deduplicated server-side), following the `gameEvents`/`gameChats` pattern in
`src/persistence/game-store.ts` rather than the one-doc-per-owner pattern used by `customMaps`:

```ts
// src/ratings/ratings.types.ts
export interface GameRatingDoc {
  _id: string; // randomUUID()
  userId: string;
  gameId: string;
  roomId: string;
  stars: number; // 1–5, integer
  createdAt: Date;
}
```

**`RatingsRepo`** (`src/ratings/ratings.repo.ts`) — native `mongodb` driver, mirrors
`CustomMapRepo`'s shape:

```ts
@Injectable()
export class RatingsRepo implements OnModuleInit {
  private readonly col: Collection<GameRatingDoc>;
  constructor(@Inject(MONGO_DB) db: Db) {
    this.col = db.collection<GameRatingDoc>('gameRatings');
  }
  async onModuleInit(): Promise<void> {
    await this.col.createIndex({ gameId: 1 });
    await this.col.createIndex({ userId: 1, createdAt: -1 });
    await this.col.createIndex({ createdAt: -1 }); // dashboard listing/cursor
  }
  async insert(userId: string, gameId: string, roomId: string, stars: number): Promise<GameRatingDoc> { ... }
  listPage(cursor: { t: Date; id: string } | null, limit: number): Promise<GameRatingDoc[]> { ... }
  async summary(): Promise<{ avgStars: number | null; totalCount: number }> { ... } // simple aggregate
  async deleteByUser(userId: string): Promise<number> { ... }
}
```

**`POST /api/v1/ratings`** (`src/ratings/ratings.controller.ts`, `@UseGuards(AccessTokenGuard)` —
guests may rate too, same posture as chat/rematch-vote):

```ts
export const SubmitRatingSchema = z.object({
  gameId: z.string().min(1),
  roomId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
});
export class SubmitRatingDto extends createZodDto(SubmitRatingSchema) {}
```

The controller calls `this.ratings.insert(user.userId, body.gameId, body.roomId, body.stars)`
directly (no separate service layer — this module is simple enough that `HistoryController`'s
"controller calls repo directly" pattern applies) and returns the created row. No server-side
verification that the caller actually played `gameId`/`roomId` — the client already reads both
values from its own authoritative session state (`store/ui.ts`), and a spoofed value only pollutes
analytics, not a security boundary, so that check is intentionally skipped (YAGNI).

**Account-deletion cascade**: `dashboard-users.service.ts`'s `delete()` (line ~137) gains
`await this.ratings.deleteByUser(userId);` next to the existing `this.maps.deleteByOwner(userId)`
call, so a hard-deleted account doesn't leave orphaned rating rows — every other user-owned
collection in that cascade is cleaned up the same way.

**Module wiring**: `src/ratings/ratings.module.ts` (controller + repo), added to `AppModule`'s
`imports`, same shape as `HistoryModule`.

## Dashboard read surface (`ratings.read` permission)

- `packages/shared/src/dashboard.ts`: add `'ratings.read'` to `DASHBOARD_PERMISSIONS` and to
  `VIEWER_PERMISSIONS` (read-only, same tier as `games.read`/`rooms.read`/`maps.read`).
- `src/dashboard/dashboard-ratings.controller.ts` + `.service.ts`, mirroring
  `DashboardMapsController`/`DashboardMapsService` exactly: `@UseGuards(AccessTokenGuard,
DashboardGuard)`, `@RequirePermission('ratings.read')`.
  - `GET /api/v1/dashboard/ratings?cursor&limit` → `{ ratings: [...], nextCursor, avgStars,
totalCount }` using the existing `encodeCursor`/`decodeCursor` helpers (`src/dashboard/cursor.ts`)
    against `(createdAt, _id)`.
  - Row shape: `{ id, userId, userDisplayName, gameId, roomId, stars, createdAt }` — display name
    resolved the same way `DashboardMapsService.displayNames` does (batch `users.find({_id:{$in}})`
    projecting `displayName`).
- Registered in `dashboard.module.ts` alongside the other dashboard sub-controllers/services.

**`apps/admin`**:
- `src/views/RatingsView.tsx` (new) — modeled on `AuditView.tsx` (the simplest existing list view:
  no drawer, no destructive actions): a one-line stat (`avgStars` formatted to 1 decimal +
  `totalCount`) above a cursor-paginated `oc-table` (columns: stars — rendered as `★×N`, user,
  short gameId, short roomId, submitted-at via `fmtDateTime`).
- `src/App.tsx`: add `'ratings'` to `AdminView`, a `NAV` entry (`{ view: 'ratings', permission:
'ratings.read', icon: Star }`), and the `ActiveView` switch case.
- `src/store/ui.ts`: add `'ratings'` to the router's path union.
- `src/net/rest.ts`: `listRatings({cursor?, limit?})` following the existing `listAudit`/`listRooms`
  one-liner shape.
- `src/i18n/index.ts`: new `ratings.*` keys (zh-Hant + en) — title, column headers, avg/total
  summary line.

## End-game screen (`apps/web/src/components/ScoreBoard.tsx`)

**`components/StarRating.tsx`** (new) — controlled, reused nowhere else yet:

```ts
interface StarRatingProps {
  value: number; // 0 = none selected
  onChange: (stars: number) => void;
  size?: number; // default 32 — roughly 2x the scoreboard's existing 13–15px icon glyphs
  disabled?: boolean;
}
```

Five `lucide-react` `Star` buttons in a row; filled (`fill="currentColor"`) for indices `<= value`
(or `<= hovered` while hovering), outline otherwise. Each is a real `<button>` for keyboard/AT
access (`aria-label={t('starRatingValue', {n})}`), not a bare `<svg onClick>`.

**`ScoreBoard.tsx` changes**:
- Reads `gameId`/`roomCode` straight from `useUiStore` (both already tracked there for the
  duration of a game — `enterGame(gameId, ticket)` sets `gameId` and leaves `roomCode` from the
  prior room entry untouched, so both are populated through `GAME_OVER`). No new props needed.
- New local state: `stars` (0–5), `submitting`, and a derived `alreadyRated` computed from
  `localStorage` (see below).
- New section rendered between the existing rematch-row and `.scoreboard-actions`:
  ```tsx
  <div className="scoreboard-rating">
    <span className="scoreboard-rating-label">{t('rateAppPrompt')}</span>
    {alreadyRated ? (
      <span className="scoreboard-rating-thanks">{t('ratingThanks')}</span>
    ) : (
      <>
        <StarRating value={stars} onChange={setStars} size={32} disabled={submitting} />
        <button
          className="primary"
          disabled={stars === 0 || submitting}
          onClick={() => void submitRating()}
        >
          {t('submitRating')}
        </button>
      </>
    )}
  </div>
  <div className="scoreboard-discord">
    <button className="discord-cta" onClick={openDiscord}>
      <DiscordGlyph size={18} /> {t('home.welcome.discordCta')}
    </button>
  </div>
  ```
- `submitRating()`: calls `api.submitRating({ gameId, roomId: roomCode, stars })`
  (`net/rest.ts`, new method), then on success marks this `gameId` rated in `localStorage` and
  flips `alreadyRated`. On failure, leaves the widget interactive and surfaces the existing
  `error` styling used elsewhere on this screen (best-effort — not worth a retry/backoff design
  for a feedback widget).

**Repeat-prompt behavior**: `localStorage` key `trm.ratedGameIds` (matching the `trm.*` convention
in `store/ui.ts`) holds a JSON array of gameIds the client has successfully submitted a rating for.
`ScoreBoard` checks membership on mount and after a successful submit. This means: a fresh game's
end screen always shows the widget; a game already rated shows the "thanks" state even across a
refresh/reconnect; the server is never asked "has this user rated this game" (no extra GET
endpoint) since the check is purely a client-side nag-avoidance affordance, not an enforced
one-rating-per-game rule (the server happily accepts a duplicate `insert` if `localStorage` is
cleared — consistent with "ratings are append-only, never mutate old ones").

**Discord button visibility**: unconditional — renders regardless of `alreadyRated`, matching the
"always visible on the end-game screen" decision (not gated behind submitting a rating).

## Shared Discord button styling

`WelcomeScreen.tsx`'s button (`welcome-discord-cta` in `apps/web/src/styles/home.css`) is the
canonical look (Discord blurple `#5865f2`, pill shape, `DiscordGlyph` + label). Rather than
duplicating that CSS block into `game.css`, extract a shared `.discord-cta` class into `app.css`
(loaded globally — same file that already carries the base `.modal`/`.modal-backdrop` rules used
across screens) and point both `WelcomeScreen` and `ScoreBoard` at it. `home.css`'s
`.welcome-discord` (layout: centered row, top margin) and a new `.scoreboard-discord` (same, scoped
margin for this context) stay separate per-screen layout wrappers; only the button's own visual
style moves to the shared class.

## i18n (`apps/web/src/i18n/index.ts`)

New keys, added to both the `zh-Hant` and `en` `translation` blocks (flat top-level, matching how
`gameOver`/`leaveGame`/etc. already live rather than nested under `home.welcome`, since these apply
to the in-game scoreboard, not the welcome screen):

- `rateAppPrompt` — "這場遊戲玩得如何？" / "How was this game?"
- `submitRating` — "送出評分" / "Submit rating"
- `ratingThanks` — "感謝你的評分！" / "Thanks for rating!"
- `starRatingValue` — "{{n}} 顆星" / "{{n}} star(s)" (interpolated `aria-label`)

## Edge cases

- **Guest players**: allowed to rate (`AccessTokenGuard` only, no `RegisteredUserGuard`) — a guest
  session's `userId` is a real (TTL'd) `users` doc id, same as everywhere else ratings would key on.
- **Spectators**: `ScoreBoard` renders for spectators too (no seat-based gate today); a spectator
  can submit a rating like any other viewer — acceptable, since this is an "overall app
  experience" rating, not a per-seat game review.
- **Practice-vs-bots games**: no special-casing — `gameId`/`roomId` are whatever the practice flow
  already assigns; rating a bot practice game is a legitimate signal.
- **Network failure on submit**: widget stays interactive, no `localStorage` write, so the user can
  retry; no automatic retry loop.
- **`roomCode` absent** (should not happen while `view === 'game'`, but the store type is
  nullable): if either `gameId` or `roomCode` is null when `ScoreBoard` mounts, the rating section
  is not rendered at all (silently) rather than submitting with an empty string — this is a
  defensive fallback, not an expected path.

## Implementation surface

**`apps/server`**:
1. `src/ratings/ratings.types.ts`, `ratings.repo.ts`, `ratings.controller.ts`, `ratings.module.ts`
   (new).
2. `src/app.module.ts` — register `RatingsModule`.
3. `src/dashboard/dashboard-ratings.service.ts`, `dashboard-ratings.controller.ts` (new).
4. `src/dashboard/dashboard.module.ts` — register the new controller/service.
5. `src/dashboard/dashboard-users.service.ts` — add the `deleteByUser` cascade call.
6. `packages/shared/src/dashboard.ts` — add `ratings.read` permission.
7. **Tests**: `ratings.controller.e2e` (submit, validation rejects out-of-range stars),
   `dashboard-ratings` e2e (permission-gated list + summary), a unit/e2e check that account
   deletion removes the user's rating rows.

**`apps/web`**:
1. `src/components/StarRating.tsx` (new) + a small `StarRating.test.tsx`.
2. `src/components/ScoreBoard.tsx` — rating section + Discord button + `submitRating` wiring.
3. `src/net/rest.ts` — `submitRating(...)` method.
4. `src/i18n/index.ts` — new keys (zh-Hant + en).
5. `src/styles/app.css` — new shared `.discord-cta` class (extracted from `home.css`).
6. `src/styles/home.css` — `WelcomeScreen` points at `.discord-cta` instead of
   `.welcome-discord-cta`.
7. `src/styles/game.css` — `.scoreboard-rating`, `.scoreboard-discord` layout rules.
8. `src/components/ScoreBoard.test.tsx` — rating widget renders, submit disabled until a star is
   picked, submit calls `api.submitRating` with the right payload, `alreadyRated` persists via
   `localStorage`, Discord button always present.

**`apps/admin`**:
1. `src/views/RatingsView.tsx` (new) + `RatingsView.test.tsx`.
2. `src/App.tsx`, `src/store/ui.ts` — nav entry + routing.
3. `src/net/rest.ts` — `listRatings(...)`.
4. `src/i18n/index.ts` — `ratings.*` keys (zh-Hant + en) + `perm['ratings.read']` label.

## Out of scope

- No per-match rating (explicitly decided against — this is an overall-experience rating, only
  tagged with `gameId`/`roomId` for correlation).
- No editing or deleting a previously-submitted rating from the client (append-only by design).
- No moderation actions on the dashboard ratings page (no delete/flag) — read-only for now.
- No push/email nudge to rate; the prompt only ever appears passively on the end-game screen.

## Success criteria

- After a game ends, `ScoreBoard` shows a 32px five-star widget and a submit button; submitting
  posts to `POST /api/v1/ratings` and persists a new `gameRatings` document tagged with the
  correct `gameId`/`roomId`/`userId`/`stars`.
- Re-opening the same game's end screen (or refreshing) shows a "thanks" state instead of the
  widget; a different game's end screen shows the widget again.
- The Discord button renders on every end-game screen regardless of rating state, visually
  matching `WelcomeScreen`'s button, and opens the same invite URL.
- A maintainer with `ratings.read` sees a paginated ratings list + average/total in
  `apps/admin`'s new Ratings nav item; one without the permission does not see the nav item and
  gets 403 hitting the endpoint directly.
- Deleting a user account via the dashboard removes that user's `gameRatings` rows.
- `yarn workspace @trm/server test`, `yarn workspace @trm/web test`, `yarn workspace @trm/admin
test`, `yarn lint`, and `yarn typecheck` all pass.
