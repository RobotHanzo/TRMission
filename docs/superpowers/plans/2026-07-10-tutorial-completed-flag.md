# Tutorial-Completed Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a `tutorialCompleted` flag on the user account (set once the guided tutorial's finale is reached), show it read-only + resettable in the admin user management page, and nudge (never block) users who try to practice with bots or jump straight into a real game from the welcome screen without having completed it.

**Architecture:** A new `tutorialCompleted: boolean` field on the server's `UserDoc`, defaulted `false`, surfaced on `PublicUser` (self-service) and the dashboard's user row/detail DTOs. One new self-service endpoint (`POST /auth/me/tutorial-completed`) sets it true from the tutorial finale; one new dashboard endpoint (`POST /dashboard/users/:id/tutorial-reset`, moderator+) clears it, audited. On the web client, `WelcomeScreen`'s Practice/Jump-in options are intercepted by a small recommendation dialog when the flag is false — dismissing or confirming always lets the original action proceed. `WelcomeScreen`'s own show/hide gating (the existing "0 completed real games" history proxy) is untouched.

**Tech Stack:** NestJS + Mongo (native driver) + zod/nestjs-zod (`apps/server`); React + Vite + zustand + react-i18next (`apps/web`, `apps/admin`); vitest + supertest (server e2e) / @testing-library/react (web, admin).

## Global Constraints

- UI strings ship in **Traditional Chinese (primary) + English** — every new i18n key needs both, added to both locale blocks in the same file.
- The popup is a **soft recommendation only** — every path through it must still let the user proceed with their original action (practice or jump-in) without completing the tutorial.
- **Server is authoritative** — the flag lives on `UserDoc` in Mongo; the client never invents or infers this state locally.
- `WelcomeScreen`'s existing show/hide gating (history-proxy: "0 completed games as a player") stays exactly as-is — this feature does not touch it.
- **swc, not tsx/esbuild** for `apps/server` — NestJS DI depends on emitted decorator metadata. Don't touch `dev`/`test` tooling.
- Follow the repo's git workflow: commit only after the relevant build/typecheck/lint/test commands pass, and stage only the files this work actually changed (never `git add -A`/`git add .`).

---

### Task 1: Server — self-service "mark tutorial completed" endpoint

**Files:**

- Modify: `apps/server/src/auth/user.repo.ts`
- Modify: `apps/server/src/auth/auth.types.ts`
- Modify: `apps/server/src/auth/auth.schemas.ts`
- Modify: `apps/server/src/auth/auth.service.ts`
- Modify: `apps/server/src/auth/auth.controller.ts`
- Test: `apps/server/test/auth.e2e.spec.ts`

**Interfaces:**

- Produces: `UserRepo.setTutorialCompleted(userId: string, value: boolean): Promise<UserDoc | null>` — used again in Task 2 (admin reset, called with `false`).
- Produces: `AuthService.completeTutorial(userId: string): Promise<PublicUser>`.
- Produces: `PublicUser.tutorialCompleted: boolean` (both the `auth.types.ts` interface and the `auth.schemas.ts` zod `PublicUserSchema`) — consumed by `apps/web`'s `net/rest.ts` `PublicUser` type in Task 3.
- Produces: `POST /api/v1/auth/me/tutorial-completed` → 200, body is the updated `PublicUser`.

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/server/test/auth.e2e.spec.ts`, right after the existing `describe('auth: display preferences round-trip', ...)` block (after line 161):

```ts
describe('auth: tutorial completion flag', () => {
  it('defaults to false, flips to true, and is idempotent', async () => {
    const reg = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'tut@example.com', password: 'password123', displayName: 'Tut' })
      .expect(201);
    expect(reg.body.user.tutorialCompleted).toBe(false);
    const token = reg.body.accessToken;

    const first = await request(server())
      .post('/api/v1/auth/me/tutorial-completed')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(first.body.tutorialCompleted).toBe(true);

    // Idempotent: calling again still returns true, no error.
    const second = await request(server())
      .post('/api/v1/auth/me/tutorial-completed')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(second.body.tutorialCompleted).toBe(true);

    const me = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.tutorialCompleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test auth.e2e`
Expected: FAIL — `reg.body.user.tutorialCompleted` is `undefined`, and `POST /api/v1/auth/me/tutorial-completed` 404s (route doesn't exist yet).

- [ ] **Step 3: Add the field to `UserDoc` + a repo method**

In `apps/server/src/auth/user.repo.ts`, add the field to the `UserDoc` interface (after `features?: UserFeature[];`, line 31):

```ts
  /** Dashboard-granted gated features (absent/empty = none — the default for everyone). */
  features?: UserFeature[];
  /** Set once the user reaches the guided tutorial's finale (self-reported by the client). */
  tutorialCompleted?: boolean;
}
```

Update `toPublicUser` (line 34-48) to default it:

```ts
export const toPublicUser = (u: UserDoc): PublicUser => ({
  id: u._id,
  displayName: u.displayName,
  isGuest: u.isGuest,
  features: u.features ?? [],
  tutorialCompleted: u.tutorialCompleted ?? false,
  // Merge stored prefs over the defaults so docs written before a field existed still get a
  // complete set; a legacy top-level `locale` is honoured when the prefs blob predates it.
  preferences: {
    ...DEFAULT_PREFERENCES,
    ...(u.locale ? { locale: u.locale } : {}),
    ...u.preferences,
  },
  ...(u.email ? { email: u.email } : {}),
  ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
});
```

Add a new repo method right after `setFeatures` (after line 220, before `listFeatured`):

```ts
  /** Set/clear the tutorial-completed flag — self-service completion (`true`), or a dashboard
   *  reset (`false`). Available to guests too (no `isGuest` filter, unlike `setFeatures`). */
  setTutorialCompleted(userId: string, value: boolean): Promise<UserDoc | null> {
    return this.col.findOneAndUpdate(
      { _id: userId },
      { $set: { tutorialCompleted: value } },
      { returnDocument: 'after' },
    );
  }
```

- [ ] **Step 4: Add the field to the server-internal `PublicUser` type**

In `apps/server/src/auth/auth.types.ts`, update the `PublicUser` interface (line 70-79):

```ts
export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  /** Per-account gated features (dashboard-granted). Empty for everyone by default. */
  features: UserFeature[];
  /** Whether this account has reached the guided tutorial's finale. */
  tutorialCompleted: boolean;
  email?: string;
  avatarUrl?: string;
}
```

- [ ] **Step 5: Add the field to the zod `PublicUserSchema`**

In `apps/server/src/auth/auth.schemas.ts`, update `PublicUserSchema` (line 36-43):

```ts
export const PublicUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  isGuest: z.boolean(),
  tutorialCompleted: z.boolean(),
  preferences: PreferencesSchema,
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});
```

- [ ] **Step 6: Add the service method**

In `apps/server/src/auth/auth.service.ts`, add right after `updatePreferences` (after line 102, before the closing `}`):

```ts
  async completeTutorial(userId: string): Promise<PublicUser> {
    const user = await this.users.setTutorialCompleted(userId, true);
    if (!user) throw new UnauthorizedException('user not found');
    return toPublicUser(user);
  }
```

- [ ] **Step 7: Add the controller route**

In `apps/server/src/auth/auth.controller.ts`, add right after the `updatePreferences` method (after line 203, before the OAuth section comment):

```ts
  @Post('me/tutorial-completed')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Mark the guided tutorial as completed for the current user' })
  @ApiResponse({ status: 200, schema: apiSchema(PublicUserSchema) })
  async completeTutorial(@CurrentUser() user: AuthUser) {
    return this.auth.completeTutorial(user.userId);
  }
```

(`Post`, `HttpCode`, `UseGuards`, `ApiBearerAuth`, `ApiOperation`, `ApiResponse`, `AccessTokenGuard`, `CurrentUser`, `PublicUserSchema`, and `apiSchema` are all already imported in this file.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `yarn workspace @trm/server test auth.e2e`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/auth/user.repo.ts apps/server/src/auth/auth.types.ts apps/server/src/auth/auth.schemas.ts apps/server/src/auth/auth.service.ts apps/server/src/auth/auth.controller.ts apps/server/test/auth.e2e.spec.ts
git commit -m "feat(server): add self-service tutorial-completed flag"
```

---

### Task 2: Server — admin reset endpoint (permission, audit, row/detail schema)

**Depends on:** Task 1 (the e2e test drives completion through `POST /auth/me/tutorial-completed`).

**Files:**

- Modify: `packages/shared/src/dashboard.ts`
- Modify: `apps/server/src/dashboard/audit.repo.ts`
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Modify: `apps/server/src/dashboard/dashboard-users.service.ts`
- Modify: `apps/server/src/dashboard/dashboard-users.controller.ts`
- Test: Create `apps/server/test/dashboard-tutorial-reset.e2e.spec.ts`

**Interfaces:**

- Consumes: `UserRepo.setTutorialCompleted(userId, false)` (Task 1).
- Produces: permission `'users.tutorialReset'` (moderator+), `DashboardAuditAction` member `'user.tutorialReset'`, `DashboardUserRowSchema.tutorialCompleted: boolean` (inherited by `DashboardUserDetailSchema`), `DashboardUsersService.resetTutorial(actor, userId)`, route `POST /api/v1/dashboard/users/:id/tutorial-reset`.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/dashboard-tutorial-reset.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registered(email: string, displayName: string) {
  const res = await request(server())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName })
    .expect(201);
  return { userId: res.body.user.id as string, token: res.body.accessToken as string };
}

let owner: Awaited<ReturnType<typeof registered>>;
let moderator: Awaited<ReturnType<typeof registered>>;
let viewer: Awaited<ReturnType<typeof registered>>;

beforeAll(async () => {
  t = await createTestApp();
  owner = await registered('owner@example.com', 'Owner');
  moderator = await registered('mod@example.com', 'Mod');
  viewer = await registered('viewer@example.com', 'Viewer');
  const now = new Date();
  await t.db.collection('dashboardAccounts').insertMany([
    { _id: owner.userId, role: 'owner', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: moderator.userId, role: 'moderator', grantedBy: 'test', grantedAt: now, updatedAt: now },
    { _id: viewer.userId, role: 'viewer', grantedBy: 'test', grantedAt: now, updatedAt: now },
  ] as never[]);
}, 60_000);
afterAll(() => t.close());

describe('dashboard tutorial-completed reset', () => {
  it('shows true after self-completion, resets to false (moderator+), audited; viewer 403', async () => {
    const alice = await registered('alice@example.com', 'Alice');
    await request(server())
      .post('/api/v1/auth/me/tutorial-completed')
      .set(auth(alice.token))
      .expect(200);

    const before = await request(server())
      .get(`/api/v1/dashboard/users/${alice.userId}`)
      .set(auth(owner.token))
      .expect(200);
    expect(before.body.tutorialCompleted).toBe(true);

    // A viewer cannot reset it.
    await request(server())
      .post(`/api/v1/dashboard/users/${alice.userId}/tutorial-reset`)
      .set(auth(viewer.token))
      .expect(403);

    // A moderator can.
    const reset = await request(server())
      .post(`/api/v1/dashboard/users/${alice.userId}/tutorial-reset`)
      .set(auth(moderator.token))
      .expect(200);
    expect(reset.body.tutorialCompleted).toBe(false);

    // Reflected in the list row too.
    const list = await request(server())
      .get('/api/v1/dashboard/users?filter=all')
      .set(auth(owner.token))
      .expect(200);
    const row = list.body.users.find((u: { id: string }) => u.id === alice.userId);
    expect(row.tutorialCompleted).toBe(false);

    // Audited.
    const audit = await request(server())
      .get('/api/v1/dashboard/audit')
      .set(auth(owner.token))
      .expect(200);
    const entry = audit.body.entries.find(
      (e: { action: string; target?: { id: string } }) =>
        e.action === 'user.tutorialReset' && e.target?.id === alice.userId,
    );
    expect(entry).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test dashboard-tutorial-reset`
Expected: FAIL — `before.body.tutorialCompleted` is `undefined` (not yet in the row projection), and the reset route 404s.

- [ ] **Step 3: Add the permission to the shared taxonomy**

In `packages/shared/src/dashboard.ts`, add to `DASHBOARD_PERMISSIONS` (after `'users.ban',`, line 19):

```ts
export const DASHBOARD_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.ban',
  'users.tutorialReset',
  'users.delete',
  'users.features',
  ...
```

And to `MODERATOR_PERMISSIONS` (after `'users.ban',`, line 56):

```ts
const MODERATOR_PERMISSIONS: readonly DashboardPermission[] = [
  ...VIEWER_PERMISSIONS,
  'users.ban',
  'users.tutorialReset',
  'games.readLog',
  'games.terminate',
  'rooms.close',
];
```

- [ ] **Step 4: Add the audit action**

In `apps/server/src/dashboard/audit.repo.ts`, add to the `DashboardAuditAction` union (after `| 'user.features'`, line 9):

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'user.tutorialReset'
  | 'user.delete'
  ...
```

- [ ] **Step 5: Add the field to the row/detail schema**

In `apps/server/src/dashboard/dashboard.schemas.ts`, update `DashboardUserRowSchema` (line 90-102):

```ts
export const DashboardUserRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
  isGuest: z.boolean(),
  avatarUrl: z.string().optional(),
  oauthProviders: z.array(z.string()),
  hasPassword: z.boolean(),
  features: z.array(UserFeatureSchema),
  tutorialCompleted: z.boolean(),
  createdAt: z.string(),
  disabledAt: z.string().optional(),
  guestExpiresAt: z.string().optional(),
});
```

(`DashboardUserDetailSchema` extends this, so it picks up the field automatically.)

- [ ] **Step 6: Wire the field into the row projection + add the service method**

In `apps/server/src/dashboard/dashboard-users.service.ts`, update `toRow` (line 25-37):

```ts
const toRow = (u: UserDoc) => ({
  id: u._id,
  displayName: u.displayName,
  ...(u.email ? { email: u.email } : {}),
  isGuest: u.isGuest,
  ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
  oauthProviders: Object.keys(u.oauth ?? {}),
  hasPassword: !!u.passwordHash,
  features: u.features ?? [],
  tutorialCompleted: u.tutorialCompleted ?? false,
  createdAt: u.createdAt.toISOString(),
  ...(u.disabledAt ? { disabledAt: u.disabledAt.toISOString() } : {}),
  ...(u.guestExpiresAt ? { guestExpiresAt: u.guestExpiresAt.toISOString() } : {}),
});
```

Add a new method right after `setFeatures` (after line 166, before `listFeatured`):

```ts
  /** Reset a user's tutorial-completed flag (dashboard `users.tutorialReset`). */
  async resetTutorial(actor: AuthUser, userId: string) {
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('user not found');
    await this.users.setTutorialCompleted(userId, false);
    await this.audit.log(
      actor,
      'user.tutorialReset',
      { type: 'user', id: userId },
      { before: target.tutorialCompleted ?? false, after: false },
    );
    return this.detail(userId);
  }
```

- [ ] **Step 7: Add the controller route**

In `apps/server/src/dashboard/dashboard-users.controller.ts`, add right after `setFeatures` (after line 134, before the closing `}` of the class):

```ts
  @Post(':id/tutorial-reset')
  @HttpCode(200)
  @RequirePermission('users.tutorialReset')
  @ApiOperation({ summary: "Reset a user's tutorial-completed flag back to false" })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardUserDetailSchema) })
  resetTutorial(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.users.resetTutorial(actor, id);
  }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `yarn workspace @trm/server test dashboard-tutorial-reset`
Expected: PASS

- [ ] **Step 9: Typecheck shared (no build step, but confirm no type errors) and re-run Task 1's test**

Run: `yarn workspace @trm/shared typecheck && yarn workspace @trm/server test auth.e2e`
Expected: both PASS (confirms the shared permission addition and the row schema change didn't regress anything).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/dashboard.ts apps/server/src/dashboard/audit.repo.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard-users.service.ts apps/server/src/dashboard/dashboard-users.controller.ts apps/server/test/dashboard-tutorial-reset.e2e.spec.ts
git commit -m "feat(server): add dashboard tutorial-reset endpoint (moderator+, audited)"
```

---

### Task 3: Web — mark tutorial completed at the finale

**Files:**

- Modify: `apps/web/src/net/rest.ts`
- Modify: `apps/web/src/store/session.ts`
- Modify: `apps/web/src/features/tutorial/TutorialScreen.tsx`
- Test: Create `apps/web/src/features/tutorial/TutorialScreen.test.tsx`

**Interfaces:**

- Produces: `PublicUser.tutorialCompleted: boolean` (web-side type, `net/rest.ts`), `api.markTutorialCompleted(): Promise<PublicUser>`, `useSession().completeTutorial(): Promise<void>`.
- Consumed by: Task 4 (`WelcomeScreen`/`HomeScreen` read `user.tutorialCompleted`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tutorial/TutorialScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { asPlayerId } from '@trm/shared';
import '../../i18n';
import TutorialScreen from './TutorialScreen';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import type { Lesson } from './types';

// A single zero-beat lesson: `done` (index >= beats.length) is true immediately, and being the
// only lesson, it's also the last — so the finale CTA renders right after picking a scope.
const STUB_LESSON: Lesson = {
  id: 'stub',
  chapter: 0,
  titleKey: 'tutorial.welcome.title',
  blurbKey: 'tutorial.welcome.blurb',
  scopes: ['core', 'full'],
  kind: 'tutorial',
  seed: 'tut-stub',
  players: [
    { id: asPlayerId('you'), seat: 0 },
    { id: asPlayerId('bot:rival'), seat: 1 },
  ],
  viewer: 'you',
  beats: [],
};

vi.mock('./curriculum', () => ({
  lessonsForScope: () => [STUB_LESSON],
}));

describe('TutorialScreen finale', () => {
  it('marks the tutorial completed before navigating home', async () => {
    const completeTutorial = vi.fn(() => Promise.resolve());
    const requestCreateGame = vi.fn();
    useSession.setState({ completeTutorial });
    useUi.setState({ requestCreateGame });

    render(<TutorialScreen />);
    fireEvent.click(await screen.findByText('完整教學')); // pick the Full scope
    const cta = await screen.findByText('建立第一場遊戲'); // the finale CTA
    fireEvent.click(cta);

    expect(completeTutorial).toHaveBeenCalled();
    await waitFor(() => expect(requestCreateGame).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test TutorialScreen`
Expected: FAIL — `completeTutorial` was never called (the finale CTA currently calls `requestCreateGame` directly with no completion side effect).

- [ ] **Step 3: Add the field + API method**

In `apps/web/src/net/rest.ts`, update the `PublicUser` interface (line 16-25):

```ts
export interface PublicUser {
  id: string;
  displayName: string;
  isGuest: boolean;
  preferences: UserPreferences;
  /** Per-account gated features granted from the maintainer dashboard. */
  features: UserFeature[];
  /** Whether this account has reached the guided tutorial's finale. */
  tutorialCompleted: boolean;
  email?: string;
  avatarUrl?: string;
}
```

Add the API method right after `updatePreferences` (after line 335):

```ts
  updatePreferences: (prefs: UserPreferences) =>
    req<PublicUser>('PATCH', '/auth/me/preferences', prefs),
  markTutorialCompleted: () => req<PublicUser>('POST', '/auth/me/tutorial-completed'),
```

- [ ] **Step 4: Add the session-store action**

In `apps/web/src/store/session.ts`, add to the `SessionState` interface (after `savePreferences(prefs: UserPreferences): Promise<void>;`, line 22):

```ts
  /** Persist display prefs to the account for registered users (guests stay localStorage-only). */
  savePreferences(prefs: UserPreferences): Promise<void>;
  /** Mark the guided tutorial as completed (called from the tutorial finale). Non-fatal on failure
   *  — a failed write just means the welcome-screen recommendation shows up again next time. */
  completeTutorial(): Promise<void>;
```

Add the implementation right after `savePreferences` (after line 85, before `clearError`):

```ts
    async savePreferences(prefs) {
      const u = get().user;
      if (!u || u.isGuest) return; // guests + anonymous persist via localStorage only
      try {
        set({ user: await api.updatePreferences(prefs) });
      } catch {
        /* non-fatal: the ui store + localStorage already hold the new value */
      }
    },
    async completeTutorial() {
      try {
        set({ user: await api.markTutorialCompleted() });
      } catch {
        /* non-fatal: popup just keeps recommending the tutorial next time */
      }
    },
```

- [ ] **Step 5: Wire the finale in `TutorialScreen.tsx`**

In `apps/web/src/features/tutorial/TutorialScreen.tsx`, add one import right after the existing `useUi` import (line 4; `useGame` is already imported on the next line and needs no change):

```ts
import { useUi } from '../../store/ui';
import { useSession } from '../../store/session';
import { useGame } from '../../store/game';
```

Update `TutorialScreen()` (line 133-137):

```ts
export default function TutorialScreen() {
  const exit = useUi((s) => s.goHome);
  // The finale CTA leaves the tutorial for home and spotlights the create-game button there (rather
  // than minting a room from inside the tutorial). It also marks the tutorial completed first, so
  // the welcome screen's recommendation dialog stops appearing for this account.
  const createGame = useUi((s) => s.requestCreateGame);
  const completeTutorial = useSession((s) => s.completeTutorial);
  const finishTutorial = () => {
    void completeTutorial();
    createGame();
  };
```

Update the `onCreateGame` prop passed to `TutorialRunner` (line 172):

```ts
onCreateGame = { finishTutorial };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn workspace @trm/web test TutorialScreen`
Expected: PASS

- [ ] **Step 7: Run the full web suite to check for regressions**

Run: `yarn workspace @trm/web test`
Expected: PASS (in particular `TutorialOverlay.test.tsx`, unaffected since it renders `TutorialOverlay` directly with its own `onCreateGame` stub).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/store/session.ts apps/web/src/features/tutorial/TutorialScreen.tsx apps/web/src/features/tutorial/TutorialScreen.test.tsx
git commit -m "feat(web): mark tutorial completed from the finale CTA"
```

---

### Task 4: Web — recommendation popup on Practice / Jump-in

**Depends on:** Task 3 (`PublicUser.tutorialCompleted` on the web `net/rest.ts` type).

**Files:**

- Create: `apps/web/src/components/TutorialRecommendDialog.tsx`
- Modify: `apps/web/src/screens/WelcomeScreen.tsx`
- Modify: `apps/web/src/screens/HomeScreen.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Modify: `apps/web/src/screens/HomeScreen.test.tsx`

**Interfaces:**

- Consumes: `PublicUser.tutorialCompleted` (Task 3).
- Produces: `WelcomeScreenProps.tutorialCompleted: boolean` (new required prop).

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/screens/HomeScreen.test.tsx`, update the shared `signedIn` fixture (line 36-42) to include the new field — defaulting it `true` so every _existing_ test (which doesn't care about this feature) keeps passing unchanged, implicitly covering the "dialog bypassed when already completed" case:

```ts
const signedIn = {
  id: 'u1',
  displayName: 'Tester',
  isGuest: false,
  preferences: { theme: 'system', colorBlind: false, locale: 'zh-Hant', boardLayout: 'rail' },
  features: [] as UserFeature[],
  tutorialCompleted: true,
} as const;
```

Then add two new tests at the end of the `describe('HomeScreen', ...)` block, after the existing `'starts a practice game with bots from the welcome screen'` test:

```ts
  it('recommends the tutorial before practicing without having completed it, but allows continuing', async () => {
    mocked.history.mockResolvedValue([]);
    useSession.setState({ user: { ...signedIn, tutorialCompleted: false } });
    render(<HomeScreen />);
    const practice = await screen.findByRole('button', { name: /開始練習/ });
    fireEvent.click(practice);
    expect(mocked.startPractice).not.toHaveBeenCalled();
    const continueAnyway = await screen.findByRole('button', { name: '直接繼續' });
    fireEvent.click(continueAnyway);
    await waitFor(() => expect(mocked.startPractice).toHaveBeenCalled());
  });

  it('recommends the tutorial before jumping in, and can route there instead', async () => {
    mocked.history.mockResolvedValue([]);
    useSession.setState({ user: { ...signedIn, tutorialCompleted: false } });
    const enterTutorial = vi.fn();
    const original = useUi.getState().enterTutorial;
    useUi.setState({ enterTutorial });
    try {
      render(<HomeScreen />);
      const continueBtn = await screen.findByRole('button', { name: /前往首頁/ });
      fireEvent.click(continueBtn);
      expect(screen.queryByText('歡迎回來，Tester')).not.toBeInTheDocument();
      const goToTutorial = await screen.findByRole('button', { name: '前往教學' });
      fireEvent.click(goToTutorial);
      expect(enterTutorial).toHaveBeenCalled();
    } finally {
      useUi.setState({ enterTutorial: original });
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test HomeScreen`
Expected: FAIL — `signedIn` doesn't have `tutorialCompleted` (TS error) and/or the new tests can't find the dialog buttons (no dialog exists yet).

- [ ] **Step 3: Create the dialog component**

Create `apps/web/src/components/TutorialRecommendDialog.tsx`:

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface TutorialRecommendDialogProps {
  onGoToTutorial: () => void;
  onContinueAnyway: () => void;
}

/** Soft nudge shown from WelcomeScreen's Practice/Jump-in options when the tutorial isn't done yet.
 *  This is a recommendation, not a gate: dismissing (Escape/backdrop click) counts as "continue
 *  anyway", same as clicking that button explicitly. */
export function TutorialRecommendDialog({
  onGoToTutorial,
  onContinueAnyway,
}: TutorialRecommendDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onContinueAnyway();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onContinueAnyway]);

  return (
    <div className="modal-backdrop" onClick={onContinueAnyway}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-recommend-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="tutorial-recommend-title">{t('home.tutorialRecommend.title')}</h3>
        </div>
        <p>{t('home.tutorialRecommend.body')}</p>
        <div className="row">
          <button type="button" onClick={onContinueAnyway}>
            {t('home.tutorialRecommend.continueAnyway')}
          </button>
          <button type="button" className="primary" onClick={onGoToTutorial}>
            {t('home.tutorialRecommend.goToTutorial')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the i18n keys**

In `apps/web/src/i18n/index.ts`, add to the zh-Hant `home` block, right after `welcome: { ... }` closes (after line 68, before the `home` object's closing `},` on line 69):

```ts
          footnote: '之後仍可從右上角「規則百科」按鈕隨時重新查看教學',
          discordCta: '加入 Discord 社群',
        },
        tutorialRecommend: {
          title: '要不要先看看教學？',
          body: '你還沒完成新手教學，建議先花 5 分鐘熟悉玩法，之後也能隨時直接開始。',
          goToTutorial: '前往教學',
          continueAnyway: '直接繼續',
        },
      },
```

And the mirrored en block (after line 638, before the `home` object's closing `},` on line 639):

```ts
          footnote: 'You can always revisit the tutorial later from the "Rules" button up top.',
          discordCta: 'Join our Discord',
        },
        tutorialRecommend: {
          title: 'Want to try the tutorial first?',
          body:
            "You haven't finished the tutorial yet. We recommend spending 5 minutes on it first, but you can always start it later too.",
          goToTutorial: 'Go to tutorial',
          continueAnyway: 'Continue anyway',
        },
      },
```

- [ ] **Step 5: Wire the dialog into `WelcomeScreen.tsx`**

Replace the full contents of `apps/web/src/screens/WelcomeScreen.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CirclePlay, GraduationCap } from 'lucide-react';
import { BrandBanner } from '../components/BrandBanner';
import { DiscordGlyph } from '../components/icons/DiscordGlyph';
import { openDiscord } from '../discord';
import { TutorialRecommendDialog } from '../components/TutorialRecommendDialog';

interface WelcomeScreenProps {
  name: string;
  tutorialCompleted: boolean;
  onStartTutorial: () => void;
  onPractice: () => Promise<void>;
  onContinue: () => void;
}

/** First entry: shown instead of the homepage while an account has 0 completed games. */
export function WelcomeScreen({
  name,
  tutorialCompleted,
  onStartTutorial,
  onPractice,
  onContinue,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when Practice/Jump-in is clicked without the tutorial completed yet — holds which action
  // to run once the recommendation dialog is resolved (either path always runs one of the two).
  const [pendingAction, setPendingAction] = useState<'practice' | 'continue' | null>(null);

  // "Practice" is the one option that fires an async API call; the other two are plain
  // navigations. On success the view switches to the game and this screen unmounts, so we only
  // ever clear `busy` on failure.
  const practice = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPractice();
    } catch {
      setError(t('home.welcome.practiceError'));
      setBusy(false);
    }
  };

  const handlePractice = () => {
    if (!tutorialCompleted) {
      setPendingAction('practice');
      return;
    }
    void practice();
  };

  const handleContinue = () => {
    if (!tutorialCompleted) {
      setPendingAction('continue');
      return;
    }
    onContinue();
  };

  const resolvePending = (run: 'practice' | 'continue') => {
    setPendingAction(null);
    if (run === 'practice') void practice();
    else onContinue();
  };

  return (
    <div className="welcome">
      <BrandBanner size="hero" className="welcome-brand" />
      <h1 className="welcome-title">{t('home.welcome.title', { name })}</h1>
      <p className="welcome-subtitle">{t('home.welcome.subtitle')}</p>

      <div className="welcome-options">
        <div className="welcome-option welcome-option--primary">
          <div className="welcome-option-icon welcome-option-icon--primary">
            <GraduationCap size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.learnTitle')}</h3>
          <p>{t('home.welcome.learnDesc')}</p>
          <button className="primary welcome-option-cta" onClick={onStartTutorial}>
            {t('home.welcome.learnCta')} →
          </button>
        </div>

        <div className="welcome-option">
          <div className="welcome-option-icon">
            <Bot size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.practiceTitle')}</h3>
          <p>{t('home.welcome.practiceDesc')}</p>
          <button className="welcome-option-cta" disabled={busy} onClick={handlePractice}>
            {busy ? t('home.welcome.practiceStarting') : `${t('home.welcome.practiceCta')} →`}
          </button>
        </div>

        <div className="welcome-option">
          <div className="welcome-option-icon">
            <CirclePlay size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.skipTitle')}</h3>
          <p>{t('home.welcome.skipDesc')}</p>
          <button className="welcome-option-cta" onClick={handleContinue}>
            {t('home.welcome.skipCta')} →
          </button>
        </div>
      </div>

      <div className="welcome-discord">
        <button className="discord-cta" onClick={openDiscord}>
          <DiscordGlyph size={18} /> {t('home.welcome.discordCta')}
        </button>
      </div>

      {error && <p className="welcome-error error">{error}</p>}
      <p className="welcome-footnote muted">{t('home.welcome.footnote')}</p>

      {pendingAction && (
        <TutorialRecommendDialog
          onGoToTutorial={() => {
            setPendingAction(null);
            onStartTutorial();
          }}
          onContinueAnyway={() => resolvePending(pendingAction)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Pass the new prop from `HomeScreen.tsx`**

In `apps/web/src/screens/HomeScreen.tsx`, update the `<WelcomeScreen>` render (line 140-149):

```tsx
if (showWelcome) {
  return (
    <WelcomeScreen
      name={user.displayName}
      tutorialCompleted={user.tutorialCompleted}
      onStartTutorial={enterTutorial}
      onPractice={startPractice}
      onContinue={() => setShowWelcome(false)}
    />
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test HomeScreen`
Expected: PASS — including every pre-existing test in the file (now implicitly exercising the `tutorialCompleted: true` bypass path via the shared fixture).

- [ ] **Step 8: Run the full web suite to check for regressions**

Run: `yarn workspace @trm/web test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/TutorialRecommendDialog.tsx apps/web/src/screens/WelcomeScreen.tsx apps/web/src/screens/HomeScreen.tsx apps/web/src/i18n/index.ts apps/web/src/screens/HomeScreen.test.tsx
git commit -m "feat(web): recommend the tutorial before practicing or jumping in without it"
```

---

### Task 5: Admin — display the flag + a moderator+ reset control

**Depends on:** Task 2 (dashboard row/detail schema + reset endpoint).

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/views/UsersView.tsx`
- Modify: `apps/admin/src/i18n/index.ts`
- Modify: `apps/admin/src/views/UsersView.test.tsx`

**Interfaces:**

- Consumes: `POST /dashboard/users/:id/tutorial-reset` (Task 2), permission `'users.tutorialReset'` (Task 2).
- Produces: `UserRow.tutorialCompleted: boolean` (also picked up by `UserDetail extends UserRow`), `api.resetUserTutorial(id: string): Promise<UserDetail>`.

- [ ] **Step 1: Write the failing tests**

In `apps/admin/src/views/UsersView.test.tsx`, add a new `describe` block at the end of the file:

```ts
describe('UsersView tutorial-completed flag', () => {
  it('shows a check mark in the table for a completed account', async () => {
    useUi.setState({ view: 'users', param: null });
    stubFetch({
      '/dashboard/users?': {
        status: 200,
        body: { users: [{ ...USER_DETAIL, tutorialCompleted: true }], nextCursor: null },
      },
    });
    render(<UsersView />);
    expect(await screen.findByText('✓')).toBeInTheDocument();
  });

  it('lets a permitted admin reset a completed account\'s tutorial flag', async () => {
    useSession.setState({
      phase: 'ready',
      user: { id: 'admin1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['users.read', 'users.tutorialReset']),
    });
    stubFetch({
      '/dashboard/users/u1/tutorial-reset': {
        status: 200,
        body: { ...USER_DETAIL, tutorialCompleted: false },
      },
      '/dashboard/users/u1': { status: 200, body: { ...USER_DETAIL, tutorialCompleted: true } },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('重置教學狀態'));
    expect(await screen.findByText('已重置教學狀態')).toBeInTheDocument();
  });

  it('hides the reset control without users.tutorialReset permission', async () => {
    stubFetch({
      '/dashboard/users/u1': { status: 200, body: { ...USER_DETAIL, tutorialCompleted: true } },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(<UsersView />);
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    expect(within(drawer).queryByText('重置教學狀態')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/admin test UsersView`
Expected: FAIL — no tutorial column/check mark rendered, no reset button exists.

- [ ] **Step 3: Add the field + API call**

In `apps/admin/src/net/rest.ts`, update the `UserRow` interface (line 45-57):

```ts
export interface UserRow {
  id: string;
  displayName: string;
  email?: string;
  isGuest: boolean;
  avatarUrl?: string;
  oauthProviders: string[];
  hasPassword: boolean;
  features: UserFeature[];
  tutorialCompleted: boolean;
  createdAt: string;
  disabledAt?: string;
  guestExpiresAt?: string;
}
```

Add the API call right after `putUserFeatures` (after line 335):

```ts
  putUserFeatures: (id: string, features: UserFeature[]) =>
    req<UserDetail>('PUT', `/dashboard/users/${encodeURIComponent(id)}/features`, { features }),
  resetUserTutorial: (id: string) =>
    req<UserDetail>('POST', `/dashboard/users/${encodeURIComponent(id)}/tutorial-reset`, {}),
```

- [ ] **Step 4: Add the i18n keys**

In `apps/admin/src/i18n/index.ts`, zh-Hant `users` block, after `wins: '勝場',` (line 129):

```ts
    wins: '勝場',
    colTutorial: '教學',
    tutorialDone: '已完成',
    tutorialNotDone: '未完成',
    resetTutorial: '重置教學狀態',
  },
```

zh-Hant `toast` block, after `userDeleted: '帳號已刪除',` (line 46):

```ts
    userDeleted: '帳號已刪除',
    tutorialReset: '已重置教學狀態',
```

en `users` block, after `wins: 'wins',` (line 511):

```ts
    wins: 'wins',
    colTutorial: 'Tutorial',
    tutorialDone: 'Completed',
    tutorialNotDone: 'Not completed',
    resetTutorial: 'Reset tutorial status',
  },
```

en `toast` block, after `userDeleted: 'Account deleted',` (line 425):

```ts
    userDeleted: 'Account deleted',
    tutorialReset: 'Tutorial status reset',
```

- [ ] **Step 5: Add the table column**

In `apps/admin/src/views/UsersView.tsx`, update the table header (line 346-355):

```tsx
<tr>
  <th>{t('users.colUser')}</th>
  <th>{t('users.colEmail')}</th>
  <th>{t('users.colKind')}</th>
  <th>{t('users.colOauth')}</th>
  <th>{t('users.colStatus')}</th>
  <th>{t('users.colTutorial')}</th>
  <th>{t('users.colCreated')}</th>
  <th>{t('users.colExpires')}</th>
</tr>
```

And the row rendering (line 367-374), inserting the new cell right after the status `<td>`:

```tsx
                <td>
                  {u.disabledAt ? (
                    <SignalBadge aspect="stop" label={t('users.disabledBadge')} />
                  ) : (
                    <SignalBadge aspect="clear" label={t('users.active')} />
                  )}
                </td>
                <td>
                  {u.tutorialCompleted ? '✓' : <span className="oc-muted">—</span>}
                </td>
                <td className="num">{fmtDateTime(u.createdAt, locale)}</td>
```

- [ ] **Step 6: Add the drawer display + reset button**

In `apps/admin/src/views/UsersView.tsx`, add a permission selector alongside the existing ones (after `const canFeatures = useSession((s) => s.hasPermission('users.features'));`, line 47):

```ts
const canFeatures = useSession((s) => s.hasPermission('users.features'));
const canResetTutorial = useSession((s) => s.hasPermission('users.tutorialReset'));
```

Add the reset handler alongside `removeUser` (after it, before the component's `return`, i.e. after line 96):

```ts
const resetTutorial = async () => {
  if (!detail) return;
  setBusy(true);
  try {
    setDetail(await api.resetUserTutorial(detail.id));
    pushToast('success', t('toast.tutorialReset'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
  }
};
```

Add a KV row inside the main info `<section>`, right after the sessions row (after line 160, before the section's closing `</section>` on line 161):

```tsx
            <div className="oc-kv">
              <span className="k">{t('users.sessions')}</span>
              <span className="v">{detail.activeSessions}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('users.colTutorial')}</span>
              <span className="v">
                {detail.tutorialCompleted ? t('users.tutorialDone') : t('users.tutorialNotDone')}
              </span>
            </div>
          </section>
```

Add the reset button as its own gated section, right after the `canFeatures` block (after line 218, before the `canBan` block on line 220):

```tsx
{
  canResetTutorial && detail.tutorialCompleted && (
    <section>
      <button className="oc-btn" disabled={busy} onClick={() => void resetTutorial()}>
        {t('users.resetTutorial')}
      </button>
    </section>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test UsersView`
Expected: PASS

- [ ] **Step 8: Run the full admin suite to check for regressions**

Run: `yarn workspace @trm/admin test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/views/UsersView.tsx apps/admin/src/i18n/index.ts apps/admin/src/views/UsersView.test.tsx
git commit -m "feat(admin): show tutorial-completed status and a moderator+ reset control"
```

---

### Task 6: Full-repo verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck everything**

Run: `yarn typecheck`
Expected: PASS across all workspaces.

- [ ] **Step 2: Lint everything**

Run: `yarn lint`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `yarn test`
Expected: PASS across `@trm/shared`, `@trm/server`, `@trm/web`, `@trm/admin` (and any other workspace turbo picks up).

- [ ] **Step 4: Confirm git status is clean aside from this feature's commits**

Run: `git status`
Expected: working tree clean (everything from Tasks 1-5 already committed); no stray unstaged files from this work.
