# Admin dashboard: developer push-notification tester

## Context

`apps/admin` (the maintainer dashboard) has no way to verify the push pipeline end-to-end.
Right now the only way to see whether FCM/APNs are configured correctly and a device actually
receives a notification is to trigger a real game event (start a game, wait for a turn timeout,
etc.) on a real device. Developers need a direct way to fire one of the four real push kinds
(`your_turn` / `game_started` / `game_over` / `game_paused`) at a specific account's registered
device(s) and see the outcome (sent / no devices / transport disabled), so push regressions can be
caught without staging a whole game.

This reuses the **existing** delivery pipeline (`PushService`, `DeviceRepo`, the real localized
`STRINGS` table) rather than inventing a parallel "send arbitrary message" path — the point is to
test the real thing.

## Backend

**`packages/shared/src/dashboard.ts`**
- Add `'push.test'` to `DASHBOARD_PERMISSIONS`.
- Add it to `ADMIN_PERMISSIONS` only (same tier as `users.features`/`config.features`/
  `maps.moderate` — this pushes a real notification to a real device, not a moderator-tier action).

**`apps/server/src/dashboard/audit.repo.ts`**
- Add `'push.test'` to the `DashboardAuditAction` union (every dashboard mutation is audited; a
  test send touches a real user's device and should be traceable to the operator who fired it).

**`apps/server/src/push/push.service.ts`**
- Refactor: extract the existing `notify()` device-fan-out loop into a private
  `deliver(userIds, kind, data): Promise<{deviceCount, sent, failed}>`. `notify()` calls it and
  discards the result (unchanged fire-and-forget behavior for game-critical callers). Add a new
  public method:
  ```ts
  async sendTest(userId: string, kind: PushKind): Promise<{enabled: boolean; deviceCount: number; sent: number; failed: number}> {
    if (!this.enabled) return { enabled: false, deviceCount: 0, sent: 0, failed: 0 };
    const { deviceCount, sent, failed } = await this.deliver([userId], kind, { test: '1' });
    return { enabled: true, deviceCount, sent, failed };
  }
  ```
  Unlike `notify()`, this does NOT swallow the outcome — the admin UI needs to distinguish
  "push disabled", "no devices registered", and "sent to N of M devices" from each other.
  No bot-id filtering needed (a dashboard target is always chosen from real accounts via
  `AccountSelectorModal`).

**`apps/server/src/dashboard/dashboard.schemas.ts`**
- Add `PushTestRequestSchema` (`userId: z.string()`, `kind: z.enum(['your_turn','game_started','game_over','game_paused'])`) and its DTO type, mirroring `ModerationReasonSchema`/`ModerationReasonDto`.
- Add `PushStatusSchema` (`{ enabled: z.boolean() }`) and `PushTestResultSchema`
  (`{ enabled: z.boolean(), deviceCount: z.number(), sent: z.number(), failed: z.number() }`),
  mirroring `PurgeStatusSchema`/`PurgeRunResultSchema`.

**`apps/server/src/dashboard/dashboard-push.controller.ts`** (new, same shape as
`dashboard-purge.controller.ts`)
- `@Get('status')` `@RequirePermission('push.test')` → `{ enabled: this.push.enabled }`.
- `@Post('test')` `@RequirePermission('push.test')` → body `PushTestRequestDto` → calls
  `push.sendTest(userId, kind)`, then `audit.log(actor, 'push.test', {type:'user', id: userId}, {kind, ...result})`, returns the result.
- Route: `api/v1/dashboard/push` (guarded by `AccessTokenGuard, DashboardGuard` like every other
  dashboard controller).

**`apps/server/src/dashboard/dashboard.module.ts`**
- Import `PushModule` (exports `PushService`, already used the same way by `game.module.ts`) and
  register `DashboardPushController`.

**Tests**
- `apps/server/test/dashboard-push.e2e.spec.ts`, following `dashboard-purge.e2e.spec.ts`'s
  pattern (register admin + moderator dashboard accounts, `guest()` helper, `t.db` assertions):
  moderator gets 403 on both routes; status reflects `PushService.enabled` (false with no env
  transports configured in tests, matching `push-service.spec.ts`'s "no-op with no transports"
  case); `POST test` against a user with no registered device returns `{deviceCount: 0, sent: 0}`
  and still writes one `push.test` audit row; 404/behavior for a bogus userId is NOT required —
  `deliver()` naturally returns `deviceCount: 0` for an unknown id (matches `DeviceRepo.listForUsers`
  behavior), so no extra validation branch is needed.

## Admin frontend (`apps/admin`)

**`src/store/ui.ts`**
- Add `'push'` to the `AdminView` union and to `parsePath`'s regex (alongside `purge`).

**`src/net/rest.ts`**
- Add `type PushKind = 'your_turn' | 'game_started' | 'game_over' | 'game_paused';` (kept local —
  four literals used only for a `<select>`, not worth a `@trm/shared` round-trip).
- Add `interface PushStatus { enabled: boolean }` and
  `interface PushTestResult { enabled: boolean; deviceCount: number; sent: number; failed: number }`.
- Add `getPushStatus: () => req<PushStatus>('GET', '/dashboard/push/status')` and
  `sendTestPush: (userId: string, kind: PushKind) => req<PushTestResult>('POST', '/dashboard/push/test', { userId, kind })`,
  next to `getPurgeStatus`/`runPurge`.

**`src/views/PushView.tsx`** (new — modeled on `PurgeView.tsx` for the load/status/toast shape and
`FeaturesView.tsx` for the account-picker shape)
- On mount: `api.getPushStatus()` → a `SignalBadge` ("clear" if enabled, "stop" + explanatory text
  if not — no FCM/APNs credentials configured server-side).
- `AccountSelectorModal` (default `filter: 'registered'`) to pick the target account; show the
  picked account as a chip with a "change" button (same interaction `FeaturesView` uses for
  `editing`).
- A `<select>` for `PushKind` (4 options, i18n-labelled), defaulting to `your_turn`.
- A "send test push" button (disabled until a user is picked; also disabled — with a hint — when
  status says push is disabled) that calls `api.sendTestPush(userId, kind)` and pushes a toast:
  - `deviceCount === 0` → warning toast: no devices registered for that account.
  - `sent > 0` → success toast with the sent count (and a note if `failed > 0` too).
  - `sent === 0 && deviceCount > 0` → error toast: all deliveries failed.
- Gate the whole view the same way `PurgeView` gates its run button: `useSession((s) => s.hasPermission('push.test'))`.

**`src/App.tsx`**
- Import `PushView`, add `{ view: 'push', permission: 'push.test', icon: BellRing }` to `NAV`
  (import `BellRing` from `lucide-react`), add the `case 'push': return <PushView />;` arm.

**`src/i18n/index.ts`**
- Add `nav.push` (both locales).
- Add a `push` block (title, statusEnabled/statusDisabled, pickUser, changeUser, kindLabel, the 4
  kind labels, send) in both the zh-Hant and en tables.
- Add `perm['push.test']` in both `perm` blocks (drives `MaintainersView`'s permission checklist —
  confirmed by grep that `MaintainersView` iterates `DASHBOARD_PERMISSIONS` and looks up
  `t('perm.' + p)`, so a missing entry would show a raw key there).
- Add `audit.action['push.test']` in both blocks (drives `AuditView`'s action label lookup, same
  pattern as the existing `purge.run` entry).
- Add `toast.pushSent`/`toast.pushNoDevices`/`toast.pushFailed` (or fold into inline strings —
  match whatever `PurgeView`'s toast calls do, i.e. `pushToast('success'|'error', t('toast....'))`).

**Tests**
- `src/views/PushView.test.tsx`, mirroring `PurgeView.test.tsx`'s `stubFetch` pattern: renders
  status, hides the send action without `push.test`, picks a user via the (already-tested)
  `AccountSelectorModal`, sends, and asserts the right toast per response shape
  (`deviceCount: 0`, `sent > 0`, `enabled: false`).

## Verification

1. `yarn workspace @trm/shared typecheck && yarn workspace @trm/shared test` (new permission).
2. `yarn workspace @trm/server test --run push-service` and
   `yarn workspace @trm/server test --run dashboard-push` (new + refactored `PushService` paths).
3. `yarn workspace @trm/admin test PushView` and `yarn workspace @trm/admin test App.test` (nav
   gating).
4. `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`.
5. Manual smoke: `docker compose up -d mongo`, run `@trm/server dev` + `@trm/admin dev`, sign in as
   an `admin`-role dashboard account, register a mobile device token for a test account (via the
   mobile app or `POST /me/devices` directly), open the new Push view, pick that account, send
   `your_turn`, confirm the toast and (if FCM/APNs env vars are set) the real push arrives.
