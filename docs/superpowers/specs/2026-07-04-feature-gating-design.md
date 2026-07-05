# Per-account feature gating: replay review & map building

**Date:** 2026-07-04
**Status:** Approved

## Goal

Replay reviewing and custom-map building become **opt-in, per-account features, disabled by
default for everyone** (including all existing accounts). Maintainers grant them to specific
accounts from the admin dashboard. A reusable account selector modal supports the granting flows
(and replaces the paste-a-userId add flow in the maintainers manager).

## Decisions (settled with the user)

1. **Map gate scope — everything custom-map.** Without the `mapBuilder` feature an account cannot
   author (create/edit/delete/share), clone shared maps, peek at share codes, or select/host a
   custom map in the lobby. Playing _in_ a custom-map game hosted by a granted user, and viewing
   existing custom-map replays, still work for everyone.
2. **Replay gate scope — own-replay browsing/sharing only.** Without the `replayReview` feature a
   member (player/spectator) cannot fetch the replay payload of their own games or manage replay
   visibility. A replay whose visibility is `link` remains viewable by **anyone holding the URL**,
   anonymous visitors included (unchanged). History list + scoreboard stay open to all.
3. **Granting permission — `users.features`,** granted to `admin` and `owner` roles (not
   moderators).
4. **Admin UI — both surfaces.** A dedicated "Features" view (add via account selector modal) and
   a features toggle section in the existing user detail drawer. The selector modal is also reused
   by MaintainersView.
5. **Storage — a field on the users doc** (`features?: UserFeature[]`), enforced by per-request
   reads (instant grant/revoke, same semantics as ban enforcement). Not a separate collection, not
   token claims.

## 1. Shared taxonomy (`packages/shared`)

- New `src/features.ts`:
  - `USER_FEATURES = ['replayReview', 'mapBuilder'] as const`
  - `type UserFeature = (typeof USER_FEATURES)[number]`
  - `isUserFeature(s: string): s is UserFeature`
- `src/dashboard.ts`: add `'users.features'` to `DASHBOARD_PERMISSIONS` and to
  `ADMIN_PERMISSIONS` (admins and owners get it; strict escalation chain preserved).
- Export from the package index. Single definition consumed by server guard, admin UI, and web —
  the established no-drift pattern.

## 2. Server enforcement (`apps/server`)

### Storage & identity

- `UserDoc.features?: UserFeature[]` — absent/empty means none (default-disabled; no migration
  needed).
- `toPublicUser` gains `features: u.features ?? []` so the web client can hide entry points.
- `UserRepo` gains a features read (used by the guard) and a set-features update (used by the
  dashboard service).

### Guard

- New `@RequireFeature('mapBuilder' | 'replayReview')` decorator + `FeatureGuard`, running after
  `AccessTokenGuard`. It reads the user doc **per request** so grants/revocations apply instantly.
  Missing feature → **403** with a stable error code (`FEATURE_DISABLED`) the web can map to an
  i18n message.

### Maps routes (`mapBuilder`)

- Gate every `api/v1/maps` route — list, create, get, update, delete, share mint/revoke, shared
  peek, shared clone — **except `GET /maps/content/:hash`**, which must remain reachable by any
  authenticated user: players and replay viewers of a custom-map game resolve board content by
  hash (the unguessable hash is the capability). Gating it would break live games and replays.
- Existing `RegisteredUserGuard` checks stay (feature gate is additive).

### Lobby (`mapBuilder`, checked on the host)

- Selecting a `{source:'custom'}` map in room settings and resolving it at `start` both verify the
  **host** holds `mapBuilder` (403 otherwise). The start-time check is authoritative — a revoke
  between select and start still blocks, and the host is told to switch maps.
- Rooms already started, live games, and completed games are untouched.

### History/replay routes (`replayReview`)

- `GET /history/:gameId/replay` access rule becomes:
  `allowed = (isMember && viewerHasReplayReview) || visibility === 'link'`.
  Members without the feature on a private replay get 403 (they already know the game exists from
  their own history; nondisclosing 404 stays for true outsiders). Anonymous/link viewing is
  unchanged.
- `PATCH /history/:gameId/visibility` requires the feature (seated-player check unchanged).
- Replay payload's `canConfigureVisibility` becomes `isPlayer && viewerHasReplayReview`.
- `GET /history` and `GET /history/:gameId` (list + scoreboard) remain open to all members.

### Dashboard API (all behind `@RequirePermission('users.features')`)

- `PUT /api/v1/dashboard/users/:id/features` — body `{ features: UserFeature[] }`, replaces the
  set. Target must be a registered (non-guest) account → 400 for guests. Appends a
  `dashboardAudit` entry (actor, target, before/after) via `AuditService`.
- `GET /api/v1/dashboard/features` — accounts holding ≥1 feature (id, displayName, email,
  features, createdAt/disabled status for badges).
- Dashboard user detail payload gains `features` so the drawer can render toggles.

## 3. Web UI gating (`apps/web`) — cosmetic; server is authority

- `PublicUser.features: UserFeature[]` flows through `net/rest.ts` types into the session store;
  new `hasFeature(f)` selector.
- Without `mapBuilder`:
  - AppHeader "My Maps" menu item + icon button hidden.
  - `/maps` and `/maps/:id/edit` route entries in `store/ui.ts` redirect home.
  - Room settings hide the custom-map source option for the host.
- Without `replayReview`:
  - HistoryScreen hides watch-replay affordances.
  - Visibility/share controls already follow the server's `canConfigureVisibility` — they
    disappear automatically.
  - `/replay/:gameId` stays reachable (shared links must work); a server 403/404 renders an error
    state with an explanatory message.
- New zh-Hant + en strings for the disabled/error states.

## 4. Admin dashboard (`apps/admin`)

### `AccountSelectorModal` (new shared component)

- Modal with a debounced search input over the existing `GET /dashboard/users` (name/email `q`),
  defaulting to the `registered` filter (configurable via prop).
- Rows: displayName, email, short id, guest/disabled badges. Click selects.
- Props: `title`, `filter?`, `excludeIds?` (hide already-granted/already-maintainer accounts),
  `onSelect(user)`, `onClose`.
- Requires `users.read` (both consuming flows already imply a maintainer with it).

### Features view (new)

- Nav item gated on `users.features`; route follows the existing view pattern in admin `App.tsx`.
- Table of granted accounts from `GET /dashboard/features`: user, features, status, actions.
- "Add account" → `AccountSelectorModal` (excluding already-granted ids) → editor drawer with a
  checkbox per `USER_FEATURES` entry → `PUT .../users/:id/features`.
- Per-row edit (same drawer) and revoke-all (confirm dialog → `PUT` with `[]`).

### UsersView drawer

- New "Features" section for registered users, visible when the viewer holds `users.features`:
  checkbox per feature + save, calling the same `PUT`.

### MaintainersView

- The paste-a-userId toolbar is replaced by an "Add" button opening `AccountSelectorModal`
  (excluding existing maintainers); selection opens the existing role/permissions `Editor`.

### i18n

- zh-Hant + en keys for the new view, modal, drawer section, and `perm.users.features`.

## 5. Testing & docs

- **shared**: taxonomy unit test — `users.features` present for admin/owner, absent for
  viewer/moderator; `isUserFeature`.
- **server e2e**:
  - Dashboard: grant/revoke round-trip, guest target → 400, audit entry appended, permission
    matrix (moderator 403, admin 200).
  - Maps: each gated route 403 without the feature, works with it; `GET /maps/content/:hash`
    reachable without the feature.
  - Lobby: custom-map select and start blocked for a non-granted host; official maps unaffected.
  - Replay: member without feature → 403 on private, 200 via `link` visibility; anonymous link
    viewing unchanged; visibility PATCH gated; `canConfigureVisibility` reflects the feature.
  - Update existing specs (`lobby-custom-map.e2e`, `history-replay.e2e`, maps specs) to grant
    features in setup.
- **web**: AppHeader hides map entries without the feature; HistoryScreen hides replay buttons;
  route redirect for `/maps`.
- **admin**: `AccountSelectorModal` search/select behavior; FeaturesView renders grants; drawer
  section permission-gated.
- **Docs**: update `apps/server/CLAUDE.md` (maps: "registered users only" → also feature-gated;
  dashboard: new permission) and `apps/web/CLAUDE.md` (builder: feature-gated). Run
  `graphify update .` after implementation.

## Explicit consequences

- All existing users lose replay browsing and map authoring until granted — intended.
- Existing `link`-visibility replays keep working for everyone with the URL.
- Existing custom maps stay in Mongo untouched; their owners simply can't open the builder or
  host them until granted. Published `mapContents` remain resolvable forever (replays/live games).
- Guests can never hold features (400 on grant attempt); map authoring already excluded guests.

## Out of scope

- No env kill-switch to re-enable globally (grants are the only mechanism).
- No changes to spectating, bots, engine, proto, or the WS plane.
- No self-service request flow for users to ask for access.
