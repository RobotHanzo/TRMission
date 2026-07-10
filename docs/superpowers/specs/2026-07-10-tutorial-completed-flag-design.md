# Design: Tutorial-completed flag + recommendation popup

**Date:** 2026-07-10
**Status:** Approved (design), pending implementation plan

## Goal

Track whether a user has finished the tutorial as a persisted, server-side flag (not the current
history-based proxy), surface it read-only (+ reset) in the admin user management page, and show a
soft, dismissible recommendation popup when a user tries to practice with bots or jump straight into
the game from the welcome screen without having completed the tutorial.

## Decisions (locked with the user)

1. **Popup is a soft recommendation, not a hard block.** The user can always proceed without doing
   the tutorial (dialog offers "Go to tutorial" or "Continue anyway").
2. **Trigger scope:** only the `WelcomeScreen`'s **Practice with bots** and **Jump right in** options
   trigger the popup. The **Learn to play** (tutorial) button itself never triggers it.
3. **`WelcomeScreen`'s own gating is unchanged.** It still shows/hides based on the existing
   history-proxy (`!rows.some(r => r.role === 'player')` in `HomeScreen.tsx`), documented in
   `2026-07-10-practice-with-bots-design.md`. The new `tutorialCompleted` flag does **not** change
   when `WelcomeScreen` itself appears — it only changes what happens when Practice/Jump-in are
   clicked while inside it.
4. **Admin panel:** read-only display **plus** a reset button (admin/moderator can clear the flag
   back to `false`; there's no way to set it `true` from the dashboard — only the user's own tutorial
   completion does that).

## Existing mechanics this builds on

- `WelcomeScreen` (`apps/web/src/screens/WelcomeScreen.tsx`) has three cards: Learn to play
  (`onStartTutorial`), Practice with bots (`onPractice`, async), Jump right in (`onContinue`,
  dismisses to the homepage). Rendered from `HomeScreen.tsx:140-149` while `showWelcome` is true.
- Tutorial finale: `TutorialOverlay.tsx:166` renders the last lesson's CTA as
  `onClick={props.onCreateGame ?? props.onExit}`; `TutorialScreen.tsx:133-137` wires
  `onCreateGame` to `useUi((s) => s.requestCreateGame)`, which navigates home and spotlights the
  create-game button (`HomeScreen.tsx:74-87`, `homeFocus`). This is the one, single completion
  moment — reaching and clicking the finale CTA on the last lesson.
- User self-service pattern: `PATCH /auth/me/preferences` (`auth.controller.ts`, backed by
  `PreferencesSchema` in `auth.schemas.ts`) — a logged-in user updates their own doc.
- Admin mutation pattern (`setFeatures`/`disable`): admin REST call
  (`apps/admin/src/net/rest.ts`) → `@RequirePermission(...)`-gated controller route
  (`dashboard-users.controller.ts`) → service method (`dashboard-users.service.ts`) → repo mutation
  (`user.repo.ts`) → audit log entry (`AuditService.log`, `dashboardAudit` collection, action name
  from the closed `DashboardAuditAction` union in `audit.repo.ts`). Permission taxonomy is
  `DASHBOARD_PERMISSIONS` in `packages/shared/src/dashboard.ts`, tiered by `ROLE_PERMISSIONS`.
- `DashboardUserRowSchema`/`DashboardUserDetailSchema` (`dashboard.schemas.ts`) are explicit
  whitelists projected by `toRow()`/detail builders in `dashboard-users.service.ts` — "never spread
  the doc," so new fields must be added deliberately at each layer.

## Server changes (`apps/server`)

### 1. `UserDoc` — `apps/server/src/auth/user.repo.ts`

Add `tutorialCompleted: boolean` (default `false`), alongside `isGuest`/`features`. New repo methods:

```
completeTutorial(userId): sets tutorialCompleted = true (idempotent)
setTutorialCompleted(userId, false): admin reset
```

### 2. Client-visible field

Add `tutorialCompleted` to `toPublicUser()` and `PublicUserSchema` (`auth.schemas.ts`) so the web
session store has it without an extra fetch.

### 3. Self-service endpoint — `auth.controller.ts`

`POST /auth/me/tutorial-completed` — no body, sets the flag `true` for the logged-in user (guests
included), idempotent, returns the updated `PublicUser`.

### 4. Admin read — `dashboard.schemas.ts` / `dashboard-users.service.ts`

Add `tutorialCompleted: z.boolean()` to `DashboardUserRowSchema` and `DashboardUserDetailSchema`;
wire it through `toRow()` and the detail projection.

### 5. Admin reset mutation

- `POST /dashboard/users/:id/tutorial-reset` in `dashboard-users.controller.ts`, `@HttpCode(200)`,
  gated by a new permission `users.tutorialReset`.
- Add `'users.tutorialReset'` to `DASHBOARD_PERMISSIONS` (`packages/shared/src/dashboard.ts`),
  assigned at the **moderator** tier in `ROLE_PERMISSIONS` — same weight-class as `users.ban`
  (reversible, non-destructive account tweak, not a security-sensitive action).
- Service method `resetTutorial(id)` → repo `setTutorialCompleted(id, false)` → audit log with a new
  action `'user.tutorialReset'` added to the `DashboardAuditAction` union (`audit.repo.ts`), recording
  `{before, after}` like the existing `user.features`/`user.ban` entries.

## Client changes — marking completion (`apps/web`)

### 6. `api.markTutorialCompleted()` — `net/rest.ts`

```
markTutorialCompleted: () => req<PublicUser>('POST', '/auth/me/tutorial-completed'),
```

### 7. `store/session.ts` — new `completeTutorial()` action

Mirrors the existing `savePreferences` action (line 77-85): non-fatal try/catch, updates `user` in
place on success, silently no-ops on failure (the ui store already reflects the user having reached
the finale regardless).

```
async completeTutorial() {
  try {
    set({ user: await api.markTutorialCompleted() });
  } catch {
    /* non-fatal: popup just keeps recommending the tutorial next time */
  }
},
```

### 8. `TutorialScreen.tsx`

Wrap the existing `requestCreateGame` call:

```
const createGame = useUi((s) => s.requestCreateGame);
const completeTutorial = useSession((s) => s.completeTutorial);
const finishTutorial = () => {
  void completeTutorial();
  createGame();
};
```

`onCreateGame={finishTutorial}` replaces the direct `createGame` reference at the call site. Best
effort: if the network call fails, the user still proceeds home — a failed flag write just means the
popup keeps recommending the tutorial next time, an acceptable non-destructive fallback.

## Client changes — the recommendation popup (`apps/web`)

### 9. New `TutorialRecommendDialog` component

Modeled on `ConfirmDialog.tsx`'s `.modal-backdrop`/`.modal` structure. Props: `onGoToTutorial`,
`onContinueAnyway`, `onDismiss` (Escape/backdrop click = same as continue-anyway, matching
`ConfirmDialog`'s existing dismiss behavior).

### 10. `WelcomeScreen.tsx` changes

- New prop `tutorialCompleted: boolean`.
- Local dialog state: `pendingAction: 'practice' | 'continue' | null`.
- Practice button (line 64) and Jump-in button (line 75): if `!tutorialCompleted`, set
  `pendingAction` instead of calling `onPractice`/`onContinue` directly; otherwise call through as
  today.
- Dialog's "Go to tutorial" calls `onStartTutorial`; "Continue anyway" calls through to the
  original deferred action based on `pendingAction`, then clears it.

### 11. `HomeScreen.tsx`

Pass `tutorialCompleted={user.tutorialCompleted}` to `<WelcomeScreen>` (line ~142-148).

### 12. i18n — `apps/web/src/i18n/index.ts`

New keys under `home.tutorialRecommend`, in both `zh-Hant` (primary) and `en`, alongside the existing
`ownerLeaveTitle`/`ownerLeaveBody` pattern:

- `title`, `body`, `goToTutorial`, `continueAnyway`

## Admin panel changes (`apps/admin`)

### 13. `net/rest.ts`

- Add `tutorialCompleted: boolean` to `UserRow`/`UserDetail` types.
- `resetTutorial: (id) => req('POST', `/dashboard/users/${id}/tutorial-reset`)`.

### 14. `UsersView.tsx` table (~line 344-355)

Add a compact ✓/✗ badge column, matching the existing `colStatus`-style rendering — not a full
labeled column, to avoid crowding the row.

### 15. `UserDrawer` (detail view, lines 42-279)

Add an `oc-kv` row showing the flag plus a small "Reset" button, visible/enabled only when the
logged-in admin has `users.tutorialReset` permission (following whatever pattern `UserDrawer`
already uses to conditionally show the ban/features controls by permission).

## Tests

- **Server:** unit/e2e for `POST /auth/me/tutorial-completed` (sets flag, idempotent) and
  `POST /dashboard/users/:id/tutorial-reset` (permission-gated, writes audit entry, flips flag
  false). `dashboard-users.service` test confirming `tutorialCompleted` appears in row/detail
  projections.
- **Web:** `WelcomeScreen` component test — dialog appears on Practice/Jump-in when
  `tutorialCompleted` is false, bypassed when true, dialog's two actions do the right thing.
  `TutorialScreen` test confirming `markTutorialCompleted` fires when the finale CTA is clicked.
- **Admin:** `UsersView` test confirming the column renders and the reset action calls the right
  endpoint and is hidden/disabled without the permission.

## Out of scope

- Any change to `WelcomeScreen`'s own show/hide gating (still the history-proxy, per decision #3).
- Setting `tutorialCompleted` from anywhere other than reaching the tutorial finale (e.g. no partial
  credit for starting-but-not-finishing).
- Surfacing tutorial-completion state anywhere in the player-facing UI beyond the popup (e.g. no
  profile badge, no "you've done the tutorial!" toast).
- Mobile app (this repo also has an in-progress mobile build; this design is web + admin only).
