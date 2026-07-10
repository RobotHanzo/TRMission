# Default feature flags + events-on-by-default

**Date:** 2026-07-10
**Status:** Approved (design)

## Problem

`USER_FEATURES` (`replayReview`, `mapBuilder`, `randomEvents`) is a flat per-account allow-list —
every account is off unless a maintainer grants it from the dashboard's Features view
(`PUT /dashboard/users/:id/features`). There is no concept of a **global default**: to turn a
feature on for everyone, a maintainer would have to grant it account-by-account. Three related
asks:

1. Add the ability to change the default feature flags from the admin dashboard.
2. Enable `randomEvents` by default (for every account, not per-account grants).
3. New rooms should default to "medium" events instead of off.

## Decisions (from brainstorming)

1. **Defaults are dynamic, not baked at account creation.** Effective features = the global
   default set **∪** the account's own explicit grants, computed fresh on every read — the same
   shape as the dashboard's `effectivePermissions` (role ∪ extra), minus a "deny" side (nothing in
   the current feature model needs one; adding it would be scope creep). Changing a default
   retroactively changes every account that hasn't been explicitly granted the feature — no
   migration of existing accounts, no new-user-creation wiring.
2. **Editor lives inside the existing Features view**, as a new panel above the per-user table,
   reusing `FeatureToggles.tsx` (generalized to target either one account or the global defaults)
   rather than a new standalone settings view.
3. **New dedicated permission `config.features`, admin tier** — same tier as `users.features`
   (viewer/moderator can't see or edit it), but tracked separately so the two can diverge later.
4. **"Medium" events → `DEFAULT_ROOM_SETTINGS.eventsMode = 'moderate'`** (third of the four
   `off/light/moderate/intense` tiers — there's no literal "medium").

## Architecture

### `@trm/shared` — permission taxonomy

`packages/shared/src/dashboard.ts`:

- Add `'config.features'` to `DASHBOARD_PERMISSIONS`.
- Add `'config.features'` to `ADMIN_PERMISSIONS` (admin + owner inherit; viewer/moderator do not).

No changes to `packages/shared/src/features.ts` — `USER_FEATURES` itself is unchanged; defaults
are runtime data, not code.

### `apps/server` — storage, effective-features computation, endpoint

**New collection `featureDefaults`** — one document, fixed `_id: 'singleton'`:

```ts
interface FeatureDefaultsDoc {
  _id: 'singleton';
  features: UserFeature[];
}
```

**New `FeatureDefaultsRepo`** (`apps/server/src/auth/feature-defaults.repo.ts`), same shape as
`UserRepo`/`RoomRepo` — `@Injectable`, injects `MONGO_DB`:

```ts
async get(): Promise<UserFeature[]>                      // findOne({_id:'singleton'}) → doc?.features ?? []
async set(features: UserFeature[]): Promise<UserFeature[]>  // findOneAndUpdate(upsert) → .features
```

**`UserRepo.hasFeature`** (`apps/server/src/auth/user.repo.ts:207-211`) becomes the single choke
point for effective-feature checks — inject `FeatureDefaultsRepo`, check the account's own grant
first (no extra read in the common explicit-grant case), fall through to the defaults doc only if
not directly granted:

```ts
async hasFeature(userId: string, feature: UserFeature): Promise<boolean> {
  const doc = await this.col.findOne({ _id: userId }, { projection: { features: 1 } });
  if (doc?.features?.includes(feature)) return true;
  return (await this.defaults.get()).includes(feature);
}
```

This is the **only** server-side gate change needed — it transparently fixes every existing call
site with no other edits: `FeatureGuard` (`mapBuilder` on `MapsController`), `lobby.service.ts`'s
`assertEventsAllowed` (settings PATCH) and the `start()` re-check (both `randomEvents`), and
`history.controller.ts`'s visibility/replay checks (`replayReview`).

**`AuthService`** (`apps/server/src/auth/auth.service.ts`) merges defaults into the `PublicUser`
it returns, so the web client's `useHasFeature()` (nav gating, the events-mode picker's
`canConfigureEvents`, etc.) matches what the server enforces. Inject `FeatureDefaultsRepo`; in
`issue`, `me`, and `updatePreferences`, after calling `toPublicUser(user)`:

```ts
const defaults = await this.defaults.get();
return { ...pub, features: [...new Set([...pub.features, ...defaults])] };
```

`toPublicUser` itself is unchanged (still a pure function of `UserDoc`).

**New dashboard endpoint** `GET /dashboard/config/features` + `PUT /dashboard/config/features`,
mirroring the `users/:id/features` pair:

- `dashboard.schemas.ts`: `ConfigFeaturesPutSchema = z.object({ features: z.array(UserFeatureSchema).max(USER_FEATURES.length) })` + `ConfigFeaturesPutDto`.
- New `DashboardConfigController` (`apps/server/src/dashboard/dashboard-config.controller.ts`),
  `@Controller('api/v1/dashboard/config')`, `@UseGuards(AccessTokenGuard, DashboardGuard)`:
  - `@Get('features')` / `@RequirePermission('config.features')` → `{ features: UserFeature[] }`
  - `@Put('features')` / `@HttpCode(200)` / `@RequirePermission('config.features')` → same shape
- New `DashboardConfigService` (thin, mirrors `DashboardUsersService.setFeatures`): dedupe, call
  `FeatureDefaultsRepo.set`, audit-log with before/after.
- `audit.repo.ts`: add `'config.features'` to `DashboardAuditAction`. No target entity exists for
  a global change, so log with `target: undefined` — same pattern as `purge.run`.
- `dashboard.module.ts`: register `FeatureDefaultsRepo` (provided by `AuthModule`, already
  imported), `DashboardConfigController`, `DashboardConfigService`.

Per-user feature editing (`PUT /dashboard/users/:id/features`, `UserRepo.setFeatures`,
`UserRepo.listFeatured`) is **unchanged** — it continues to read/write only the raw per-account
grant array; the defaults layer purely adds to what an account effectively holds.

### `apps/admin` — UI

**`net/rest.ts`**: add

```ts
getDefaultFeatures: () => req<{ features: UserFeature[] }>('GET', '/dashboard/config/features'),
putDefaultFeatures: (features: UserFeature[]) =>
  req<{ features: UserFeature[] }>('PUT', '/dashboard/config/features', { features }),
```

**`FeatureToggles.tsx`**: replace the flat `userId` prop with a discriminated `target`, so the
same checkbox editor drives either endpoint:

```ts
type FeatureToggleTarget =
  | { kind: 'user'; userId: string; onSaved?: (detail: UserDetail) => void }
  | { kind: 'defaults'; onSaved?: (features: UserFeature[]) => void };

function FeatureToggles({ target, initial }: { target: FeatureToggleTarget; initial: UserFeature[] })
```

`save()` branches on `target.kind` to call `api.putUserFeatures`/`api.putDefaultFeatures` and
invoke the correspondingly-typed `onSaved`. Both existing callers update to the new shape:

- `UsersView.tsx`: `target={{ kind: 'user', userId: detail.id, onSaved: setDetail }}`
- `FeaturesView.tsx` (per-user drawer): `target={{ kind: 'user', userId: editing.id, onSaved: () => {...} }}`

**`FeaturesView.tsx`**: new panel above the existing per-user table, gated on
`hasPermission('config.features')`:

```tsx
{canEditDefaults && (
  <section>
    <h2>{t('features.defaultsTitle')}</h2>
    <p className="oc-muted">{t('features.defaultsDesc')}</p>
    <FeatureToggles target={{ kind: 'defaults', onSaved: setDefaults }} initial={defaults} />
  </section>
)}
```

loading `defaults` via `api.getDefaultFeatures()` in the view's existing `load()`/`useEffect`.

### i18n (`apps/admin/src/i18n/index.ts`, both zh-Hant and en tables)

- `features.defaultsTitle`, `features.defaultsDesc` (explain: applies to every account that
  doesn't already hold the feature directly)
- permission label `'config.features'` (same `permission-string-as-key` pattern as
  `'users.features'`)
- audit action label `config.features` (wherever `user.features` etc. are labelled for the
  Audit view)

### Events default

`apps/server/src/lobby/room.repo.ts`: `DEFAULT_ROOM_SETTINGS.eventsMode`: `'off'` → `'moderate'`.

Safe even before/without the `randomEvents` default landing: `start()`
(`lobby.service.ts:349-362`) already silently downgrades `eventsMode` to `'off'` when the host
doesn't hold the feature ("a room is never stranded" — existing comment), so a host who somehow
lacks `randomEvents` still gets a working game with events off; they just don't get the picker.
Combined with decision 1 (`randomEvents` defaulted on for everyone), in practice every new room
genuinely starts at `moderate`.

## Testing

**Server:**

- `UserRepo.hasFeature` — explicit grant wins without touching defaults; no grant + feature in
  defaults → true; neither → false.
- `AuthService.me`/`issue` — `PublicUser.features` includes both explicit grants and defaults,
  deduplicated.
- `DashboardConfigController`/`Service` — get/set round-trip, permission-gated (403 without
  `config.features`, including for a caller who only has `users.features`), audit entry written.
- `lobby.service.ts` — a room created with no explicit `eventsMode` patch starts at `moderate`
  when the host holds `randomEvents` (directly or via default), and silently at `off` when they
  don't.

**Admin (testing-library):**

- `FeatureToggles` — existing per-user tests keep passing against the new `target` prop shape; add
  a `target: {kind:'defaults'}` case exercising `getDefaultFeatures`/`putDefaultFeatures`.
- `FeaturesView` — the defaults panel is hidden without `config.features` and shown with it.

## Out of scope (YAGNI)

- No per-account **denial** of a globally-defaulted feature (the existing model has no deny
  concept; not requested).
- No migration/backfill of existing accounts or rooms — defaults apply live, going forward, to
  whoever doesn't already have an explicit grant/setting.
- No caching of the defaults doc — read per request, matching the existing "features are read per
  request, never from token claims" posture.
