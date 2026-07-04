# Admin Login Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `apps/admin`'s own email/password login dialog and instead bounce
unauthenticated visitors to `apps/web`'s `/login?redirect=<admin-path>`, resuming back at
the exact admin URL they started from once they sign in there.

**Architecture:** Both apps already share one cookie jar (same nginx origin in prod;
same-site cross-port in dev). `apps/web`'s `store/ui.ts` already generalizes `?redirect=`
handling for its own internal views; this plan adds one more case — an `/admin`-shaped
target — that does a **hard** `window.location` navigation instead of an SPA-internal
route change, since `/admin` is a separate build. `apps/admin` drops its local login
view/route entirely and, on any auth failure, hard-navigates to the main app's login
instead, carrying its own current path as the return target. No server changes.

**Tech Stack:** React 19 + Vite 5 + TypeScript, zustand for state, Vitest +
@testing-library/react for tests. Yarn 4 workspaces (`@trm/web`, `@trm/admin`).

## Global Constraints

- Node 20+, Yarn 4 (Corepack). Run scoped tests with
  `yarn workspace @trm/web test --run <substring>` /
  `yarn workspace @trm/admin test --run <substring>` (vitest substring match on file path).
- `@typescript-eslint/consistent-type-imports` is enforced (error) — use `import type` for
  type-only imports.
- i18n dictionaries must keep the **same key tree** in `zh-Hant` and `en`
  (`apps/admin/src/i18n/index.ts`'s own comment: "Keep the SAME key tree in both
  languages").
- No server (`apps/server`) changes — its `safeRedirect`/OAuth flow already accepts any
  same-origin `/admin/...` path unmodified.
- No shared auth package between the two apps — the only coupling is the shared cookie +
  the redirect round-trip.
- `DeniedView` (a valid main-app login without a `dashboardAccounts` record) is explicitly
  unchanged — do not touch it.
- Multiple agents may share this worktree: before committing, check `git status`/`git
  diff` and stage only the files this task actually touched. Never `git add -A`/`git add .`.
- Design reference: `docs/superpowers/specs/2026-07-04-admin-login-redirect-design.md`.

---

### Task 1: `apps/web` — hard-redirect `/admin` targets from `navigateAfterAuth`

**Files:**
- Create: `apps/web/src/lib/adminApp.ts`
- Create: `apps/web/src/lib/adminApp.test.ts`
- Modify: `apps/web/src/store/ui.ts:1-4` (import), `apps/web/src/store/ui.ts:270-307`
  (`navigateAfterAuth`)
- Modify: `apps/web/src/store/ui.test.ts`

**Interfaces:**
- Produces: `isAdminTarget(target: string): boolean`,
  `goToAdmin(target: string): void` — both exported from `apps/web/src/lib/adminApp.ts`.
  `goToAdmin` performs `window.location.href = <origin><target>` where `<origin>` is `''`
  in production (relative, same-origin) and a configurable dev origin
  (`VITE_ADMIN_ORIGIN`, default `http://localhost:5174`) when `import.meta.env.DEV`.

- [ ] **Step 1: Write the failing unit test for the new helper module**

Create `apps/web/src/lib/adminApp.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isAdminTarget, goToAdmin } from './adminApp';

describe('isAdminTarget', () => {
  it('matches /admin and any /admin/ sub-path', () => {
    expect(isAdminTarget('/admin')).toBe(true);
    expect(isAdminTarget('/admin/users/42')).toBe(true);
  });

  it('rejects unrelated paths, including near-misses', () => {
    expect(isAdminTarget('/room/ABCD')).toBe(false);
    expect(isAdminTarget('/administrator')).toBe(false);
    expect(isAdminTarget('/')).toBe(false);
  });
});

describe('goToAdmin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hard-navigates to a relative path in production (same origin as the admin panel)', () => {
    vi.stubEnv('DEV', false);
    const original = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...original, href: '' } });
    goToAdmin('/admin/users/42');
    expect(window.location.href).toBe('/admin/users/42');
    Object.defineProperty(window, 'location', { writable: true, value: original });
  });

  it('prefixes the dev admin origin when running under `vite dev`', () => {
    vi.stubEnv('DEV', true);
    const original = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...original, href: '' } });
    goToAdmin('/admin');
    expect(window.location.href).toBe('http://localhost:5174/admin');
    Object.defineProperty(window, 'location', { writable: true, value: original });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/web test --run adminApp`
Expected: FAIL — `Cannot find module './adminApp'` (the file doesn't exist yet).

- [ ] **Step 3: Implement the helper module**

Create `apps/web/src/lib/adminApp.ts`:

```ts
// Where the maintainer dashboard lives. Same origin in prod (nginx serves both apps
// under one domain — see apps/web/nginx.conf); dev runs the two Vite servers on
// different ports, so a plain relative redirect from :5173 would 404 instead of
// reaching admin's dev server — VITE_ADMIN_ORIGIN lets that be pointed explicitly.
const DEV_ADMIN_ORIGIN = import.meta.env.VITE_ADMIN_ORIGIN ?? 'http://localhost:5174';
const adminOrigin = (): string => (import.meta.env.DEV ? DEV_ADMIN_ORIGIN : '');

/** True for any `?redirect=` target that belongs to the admin panel, not this SPA. */
export const isAdminTarget = (target: string): boolean =>
  target === '/admin' || target.startsWith('/admin/');

/** Hard-navigate to the admin panel — it's a separate build, not a route this router owns. */
export const goToAdmin = (target: string): void => {
  window.location.href = `${adminOrigin()}${target}`;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run adminApp`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/adminApp.ts apps/web/src/lib/adminApp.test.ts
git commit -m "feat(web): add admin-target redirect helper"
```

- [ ] **Step 6: Write the failing integration test in `ui.test.ts`**

Open `apps/web/src/store/ui.test.ts`. Add the mock next to the existing
`vi.mock('../net/connection', ...)` near the top of the file:

```ts
vi.mock('../net/connection', () => ({ disconnectGame: vi.fn() }));
vi.mock('../lib/adminApp', () => ({
  isAdminTarget: (t: string) => t === '/admin' || t.startsWith('/admin/'),
  goToAdmin: vi.fn(),
}));
```

Add the import (after the existing `import { disconnectGame } from '../net/connection';`):

```ts
import { goToAdmin } from '../lib/adminApp';
```

Add a new test right after the existing `'navigateAfterAuth defaults to home when there
is no redirect target'` test (around line 98):

```ts
  it('navigateAfterAuth hard-redirects an admin-bound target instead of resuming it as an SPA view', () => {
    window.history.replaceState(null, '', '/login?redirect=%2Fadmin%2Fusers%2F42');
    useUi.getState().navigateAfterAuth();
    expect(goToAdmin).toHaveBeenCalledWith('/admin/users/42');
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `yarn workspace @trm/web test --run ui.test`
Expected: FAIL on the new test — `goToAdmin` was never called (falls through to the
existing "default to home" branch instead).

- [ ] **Step 8: Wire the helper into `navigateAfterAuth`**

In `apps/web/src/store/ui.ts`, add the import alongside the other store imports at the
top of the file:

```ts
import { isAdminTarget, goToAdmin } from '../lib/adminApp';
```

Then change the start of `navigateAfterAuth` (currently `store/ui.ts:270-272`):

```ts
  navigateAfterAuth: () => {
    const target = readRedirectParam();
    const code = ROOM_PATH.exec(target)?.[1];
```

to:

```ts
  navigateAfterAuth: () => {
    const target = readRedirectParam();
    if (isAdminTarget(target)) {
      goToAdmin(target);
      return;
    }
    const code = ROOM_PATH.exec(target)?.[1];
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run ui.test`
Expected: PASS (all existing `ui.test.ts` cases plus the new one).

- [ ] **Step 10: Run the full web test suite and typecheck**

Run: `yarn workspace @trm/web test --run` then `yarn workspace @trm/web typecheck`
Expected: both PASS with no regressions.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/store/ui.ts apps/web/src/store/ui.test.ts
git commit -m "feat(web): resume an admin-bound redirect with a hard navigation"
```

---

### Task 2: `apps/admin` — add the main-app login helper

**Files:**
- Create: `apps/admin/src/lib/mainApp.ts`
- Create: `apps/admin/src/lib/mainApp.test.ts`

**Interfaces:**
- Produces: `mainLoginUrl(returnTo: string): string`,
  `goToMainLogin(returnTo: string): void` — both exported from
  `apps/admin/src/lib/mainApp.ts`. `goToMainLogin` performs
  `window.location.href = mainLoginUrl(returnTo)`.

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/lib/mainApp.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mainLoginUrl, goToMainLogin } from './mainApp';

describe('mainLoginUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a relative /login URL carrying the redirect target in production', () => {
    vi.stubEnv('DEV', false);
    expect(mainLoginUrl('/admin/users/42')).toBe('/login?redirect=%2Fadmin%2Fusers%2F42');
  });

  it('prefixes the dev web origin when running under `vite dev`', () => {
    vi.stubEnv('DEV', true);
    expect(mainLoginUrl('/admin')).toBe('http://localhost:5173/login?redirect=%2Fadmin');
  });
});

describe('goToMainLogin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('assigns window.location.href to the main login URL', () => {
    vi.stubEnv('DEV', false);
    const original = window.location;
    Object.defineProperty(window, 'location', { writable: true, value: { ...original, href: '' } });
    goToMainLogin('/admin/games/g1');
    expect(window.location.href).toBe('/login?redirect=%2Fadmin%2Fgames%2Fg1');
    Object.defineProperty(window, 'location', { writable: true, value: original });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/admin test --run mainApp`
Expected: FAIL — `Cannot find module './mainApp'`.

- [ ] **Step 3: Implement the helper module**

Create `apps/admin/src/lib/mainApp.ts`:

```ts
// Where the main game app lives. Same origin in prod (nginx serves both apps under
// one domain — see apps/web/nginx.conf); dev runs the two Vite servers on different
// ports, so a plain relative redirect from :5174 would hit admin's own dev server
// instead of :5173 — VITE_WEB_ORIGIN lets that be pointed explicitly.
const DEV_WEB_ORIGIN = import.meta.env.VITE_WEB_ORIGIN ?? 'http://localhost:5173';
const webOrigin = (): string => (import.meta.env.DEV ? DEV_WEB_ORIGIN : '');

/** The main app's login URL, remembering the admin path to resume after sign-in. */
export const mainLoginUrl = (returnTo: string): string =>
  `${webOrigin()}/login?redirect=${encodeURIComponent(returnTo)}`;

/** Hard-navigate away to the main app's login — admin has no login dialog of its own. */
export const goToMainLogin = (returnTo: string): void => {
  window.location.href = mainLoginUrl(returnTo);
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/admin test --run mainApp`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/mainApp.ts apps/admin/src/lib/mainApp.test.ts
git commit -m "feat(admin): add main-app login redirect helper"
```

---

### Task 3: `apps/admin` — wire `session.ts` to redirect instead of gating locally

**Files:**
- Modify: `apps/admin/src/store/session.ts` (full rewrite, shown below)
- Modify: `apps/admin/src/store/session.test.ts` (full rewrite, shown below)

**Interfaces:**
- Consumes: `goToMainLogin(returnTo: string): void` from Task 2
  (`apps/admin/src/lib/mainApp.ts`).
- Produces: `SessionState` no longer has `loading`/`error`/`login` — later tasks (4) must
  not reference `useSession().loading`, `.error`, or `.login` (confirmed via repo-wide
  search that only the now-removed `LoginView` used them).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/admin/src/store/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSession } from './session';
import { goToMainLogin } from '../lib/mainApp';

vi.mock('../lib/mainApp', () => ({ goToMainLogin: vi.fn() }));

type Route = { status: number; body: unknown };

function stubFetch(routes: Record<string, Route>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hit = Object.entries(routes).find(([path]) => url.includes(path));
      const route = hit?.[1] ?? { status: 404, body: { message: 'not found' } };
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  );
}

const gameUser = (isGuest: boolean) => ({
  id: 'u1',
  displayName: 'Tester',
  isGuest,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/admin/');
  useSession.setState({
    phase: 'booting',
    user: null,
    role: null,
    permissions: new Set(),
  });
});

describe('session gate', () => {
  it('a guest session is denied even before the dashboard probe', async () => {
    stubFetch({ '/auth/me': { status: 200, body: gameUser(true) } });
    await useSession.getState().restore();
    expect(useSession.getState().phase).toBe('denied');
  });

  it('a registered user without a dashboard record is denied', async () => {
    stubFetch({
      '/auth/me': { status: 200, body: gameUser(false) },
      '/dashboard/me': { status: 404, body: { message: 'Not Found' } },
    });
    await useSession.getState().restore();
    expect(useSession.getState().phase).toBe('denied');
  });

  it('a maintainer lands ready with the permission set', async () => {
    stubFetch({
      '/auth/me': { status: 200, body: gameUser(false) },
      '/dashboard/me': {
        status: 200,
        body: {
          userId: 'u1',
          displayName: 'Tester',
          role: 'viewer',
          permissions: ['overview.read', 'users.read'],
        },
      },
    });
    await useSession.getState().restore();
    const s = useSession.getState();
    expect(s.phase).toBe('ready');
    expect(s.role).toBe('viewer');
    expect(s.hasPermission('users.read')).toBe(true);
    expect(s.hasPermission('users.ban')).toBe(false);
  });

  it('no session at all → unauthenticated, redirected to the main app login with the current admin path', async () => {
    stubFetch({
      '/auth/me': { status: 401, body: { message: 'missing bearer token' } },
      '/auth/refresh': { status: 401, body: { message: 'no refresh token' } },
    });
    window.history.replaceState(null, '', '/admin/users/42');
    await useSession.getState().restore();
    expect(useSession.getState().phase).toBe('unauthenticated');
    expect(goToMainLogin).toHaveBeenCalledWith('/admin/users/42');
  });

  it('logging out also redirects to the main app login, remembering the current admin path', async () => {
    stubFetch({ '/auth/logout': { status: 204, body: {} } });
    window.history.replaceState(null, '', '/admin/games');
    await useSession.getState().logout();
    expect(useSession.getState().phase).toBe('unauthenticated');
    expect(goToMainLogin).toHaveBeenCalledWith('/admin/games');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/admin test --run session.test`
Expected: FAIL on the last two tests — `goToMainLogin` is never called (current code
calls `gateToLogin` from `./ui` instead), and the mock module `../lib/mainApp` is unused
by the source yet.

- [ ] **Step 3: Rewrite `session.ts`**

Replace the full contents of `apps/admin/src/store/session.ts`:

```ts
// Auth/session for the dashboard: the existing game accounts sign in here, but only
// accounts with a dashboardAccounts record get past the gate. Phases:
//   booting → unauthenticated | denied | ready
// `unauthenticated` immediately hard-redirects to the main app's login (no dialog of its
// own — see lib/mainApp.ts). `denied` means the login IS valid as a game session (the
// cookie is shared) — the DeniedView says so plainly and offers logout.
import { create } from 'zustand';
import type { DashboardPermission, DashboardRole } from '@trm/shared';
import { api, ApiError, setOnTokenChange, type PublicUser } from '../net/rest';
import { goToMainLogin } from '../lib/mainApp';

export type SessionPhase = 'booting' | 'unauthenticated' | 'denied' | 'ready';

interface SessionState {
  phase: SessionPhase;
  user: PublicUser | null;
  role: DashboardRole | null;
  permissions: Set<DashboardPermission>;
  restore(): Promise<void>;
  logout(): Promise<void>;
  hasPermission(p: DashboardPermission): boolean;
}

async function probeDashboard(
  user: PublicUser,
): Promise<Pick<SessionState, 'phase' | 'user' | 'role' | 'permissions'>> {
  if (user.isGuest) {
    return { phase: 'denied', user, role: null, permissions: new Set() };
  }
  try {
    const me = await api.dashboardMe();
    return { phase: 'ready', user, role: me.role, permissions: new Set(me.permissions) };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      return { phase: 'denied', user, role: null, permissions: new Set() };
    }
    throw e;
  }
}

/** The current admin URL, used as the redirect target so sign-in resumes right here. */
const currentAdminPath = (): string => window.location.pathname + window.location.search;

export const useSession = create<SessionState>()((set, get) => ({
  phase: 'booting',
  user: null,
  role: null,
  permissions: new Set<DashboardPermission>(),

  async restore() {
    setOnTokenChange(() => {});
    try {
      const user = await api.me(); // 401 → single silent refresh via the shared cookie
      const next = await probeDashboard(user);
      set(next);
    } catch {
      set({ phase: 'unauthenticated', user: null, role: null, permissions: new Set() });
      goToMainLogin(currentAdminPath());
    }
  },

  async logout() {
    try {
      await api.logout();
    } catch {
      /* cookie may already be gone */
    }
    set({ phase: 'unauthenticated', user: null, role: null, permissions: new Set() });
    goToMainLogin(currentAdminPath());
  },

  hasPermission(p) {
    return get().permissions.has(p);
  },
}));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test --run session.test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/store/session.ts apps/admin/src/store/session.test.ts
git commit -m "feat(admin): redirect to the main app login instead of gating locally"
```

---

### Task 4: `apps/admin` — remove `LoginView` and update `App`

**Files:**
- Delete: `apps/admin/src/views/LoginView.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/App.test.tsx`

**Interfaces:**
- Consumes: `SessionPhase` (`'booting' | 'unauthenticated' | 'denied' | 'ready'`) from
  Task 3; `goToMainLogin` mock from Task 2's real module for the new test.

- [ ] **Step 1: Write the failing test**

Open `apps/admin/src/App.test.tsx`. Add near the top, after the existing imports:

```ts
vi.mock('./lib/mainApp', () => ({ goToMainLogin: vi.fn(), mainLoginUrl: vi.fn() }));
```

Change the `@testing-library/react` import to also bring in `waitFor`:

```ts
import { render, screen, waitFor } from '@testing-library/react';
```

Add this import after the `useUi` import:

```ts
import { goToMainLogin } from './lib/mainApp';
```

Update the file's `beforeEach` (drop `loading`/`error`, which no longer exist on
`SessionState`, and reset the mock):

```ts
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/admin/');
  useUi.setState({ view: 'overview', param: null });
  useSession.setState({
    phase: 'booting',
    user: null,
    role: null,
    permissions: new Set(),
  });
});
```

Add a new test inside `describe('permission-gated shell', ...)`, after the `'a denied
account gets the denied screen with a sign-out'` test:

```ts
  it('an unauthenticated visitor sees the redirecting placeholder, not a login form', async () => {
    stubFetch({
      '/auth/me': { status: 401, body: { message: 'missing bearer token' } },
      '/auth/refresh': { status: 401, body: { message: 'no refresh token' } },
    });
    window.history.replaceState(null, '', '/admin/users/42');
    render(<App />);
    await waitFor(() => expect(goToMainLogin).toHaveBeenCalledWith('/admin/users/42'));
    expect(screen.getByText('載入中…')).toBeInTheDocument();
    expect(screen.queryByText('登入')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/admin test --run App.test`
Expected: FAIL — as of Task 3, `session.ts`'s `restore()` already calls `goToMainLogin`
on failure regardless of what renders, so that part of the assertion already passes; the
`getByText('載入中…')` assertion is what fails, because `App.tsx` still renders the old
`<LoginView/>` (a form with "登入" as the submit button text) for the `'unauthenticated'`
phase instead of the same loading placeholder used for `'booting'`.

- [ ] **Step 3: Delete `LoginView.tsx` and update `App.tsx`**

Delete `apps/admin/src/views/LoginView.tsx`.

In `apps/admin/src/App.tsx`, remove this import:

```ts
import { LoginView } from './views/LoginView';
```

Replace:

```tsx
  if (session.phase === 'booting') {
    return <div className="oc-gate oc-muted">{t('common.loading')}</div>;
  }
  if (session.phase === 'unauthenticated') return <LoginView />;
  if (session.phase === 'denied') return <DeniedView />;
```

with:

```tsx
  if (session.phase === 'booting' || session.phase === 'unauthenticated') {
    return <div className="oc-gate oc-muted">{t('common.loading')}</div>;
  }
  if (session.phase === 'denied') return <DeniedView />;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test --run App.test`
Expected: PASS (all `App.test.tsx` cases, including the new one).

- [ ] **Step 5: Run the full admin test suite and typecheck**

Run: `yarn workspace @trm/admin test --run` then `yarn workspace @trm/admin typecheck`
Expected: both PASS. (Typecheck will currently still succeed even though `LoginView.tsx`
is gone and `store/ui.ts` still exports the now-unused `gateToLogin`/`leaveLogin` — those
are cleaned up in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/App.tsx apps/admin/src/App.test.tsx
git rm apps/admin/src/views/LoginView.tsx
git commit -m "feat(admin): remove the local login dialog"
```

---

### Task 5: `apps/admin` — remove the now-dead router login plumbing

**Files:**
- Modify: `apps/admin/src/store/ui.ts` (full rewrite, shown below)
- Modify: `apps/admin/src/store/ui.test.ts`

**Interfaces:**
- Produces: `AdminView` no longer includes `'login'`. Confirmed by repo-wide search that
  after Tasks 3–4, nothing outside this file and its test references `gateToLogin`,
  `leaveLogin`, or the `'login'` view.

- [ ] **Step 1: Update `ui.test.ts` to match the new `parsePath` behavior**

Replace the full contents of `apps/admin/src/store/ui.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePath, pathFor } from './ui';

describe('admin router path mapping', () => {
  it('parses base and view paths under /admin', () => {
    expect(parsePath('/admin/')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/admin')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/admin/users')).toEqual({ view: 'users', param: null });
    expect(parsePath('/admin/users/u-123')).toEqual({ view: 'users', param: 'u-123' });
    expect(parsePath('/admin/games/g%2F1')).toEqual({ view: 'games', param: 'g/1' });
    expect(parsePath('/admin/maintainers')).toEqual({ view: 'maintainers', param: null });
    expect(parsePath('/admin/audit')).toEqual({ view: 'audit', param: null });
  });

  it('unknown paths (including the retired /admin/login) fall back to overview', () => {
    expect(parsePath('/admin/nope')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/somewhere/else')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/admin/login')).toEqual({ view: 'overview', param: null });
  });

  it('pathFor round-trips through parsePath', () => {
    expect(parsePath(pathFor('users', 'abc'))).toEqual({ view: 'users', param: 'abc' });
    expect(parsePath(pathFor('rooms'))).toEqual({ view: 'rooms', param: null });
    expect(parsePath(pathFor('overview'))).toEqual({ view: 'overview', param: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @trm/admin test --run ui.test`
Expected: FAIL on the `/admin/login` case — current `parsePath` still maps it to
`{view:'login', param:null}`.

- [ ] **Step 3: Rewrite `ui.ts`**

Replace the full contents of `apps/admin/src/store/ui.ts`:

```ts
// Hand-rolled router + display prefs (the game web app's store/ui.ts pattern, smaller).
// All paths live under the /admin base (vite `base: '/admin/'`; nginx serves the same).
import { create } from 'zustand';
import i18n from '../i18n';

export type AdminView =
  | 'overview'
  | 'users'
  | 'features'
  | 'games'
  | 'rooms'
  | 'maintainers'
  | 'audit';

export type AdminTheme = 'dark' | 'light';
export type AdminLocale = 'zh-Hant' | 'en';

const BASE = '/admin';
const THEME_KEY = 'trm.admin.theme';
const LOCALE_KEY = 'trm.admin.locale';

/** /admin/users/abc → { view: 'users', param: 'abc' }. Unknown paths → overview. */
export function parsePath(pathname: string): { view: AdminView; param: string | null } {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  if (!p.startsWith('/')) p = `/${p}`;
  const m = /^\/(users|features|games|rooms|maintainers|audit)(?:\/([^/]+))?\/?$/.exec(p);
  if (m) return { view: m[1] as AdminView, param: m[2] ? decodeURIComponent(m[2]) : null };
  return { view: 'overview', param: null };
}

export function pathFor(view: AdminView, param?: string | null): string {
  if (view === 'overview') return `${BASE}/`;
  if (param) return `${BASE}/${view}/${encodeURIComponent(param)}`;
  return `${BASE}/${view}`;
}

const pushPath = (path: string): void => {
  if (window.location.pathname !== path) window.history.pushState(null, '', path);
};

const readTheme = (): AdminTheme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};
const readLocale = (): AdminLocale => {
  try {
    return localStorage.getItem(LOCALE_KEY) === 'en' ? 'en' : 'zh-Hant';
  } catch {
    return 'zh-Hant';
  }
};

const applyTheme = (theme: AdminTheme): void => {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable */
  }
};

interface UiState {
  view: AdminView;
  /** Detail id for users/games (a drawer over the list). */
  param: string | null;
  theme: AdminTheme;
  locale: AdminLocale;
  navigate(view: AdminView, param?: string | null): void;
  /** Detail drawers push their id into the URL so refresh/share lands back on them. */
  openDetail(view: 'users' | 'games', id: string): void;
  closeDetail(): void;
  syncFromUrl(): void;
  setTheme(theme: AdminTheme): void;
  toggleTheme(): void;
  setLocale(locale: AdminLocale): void;
}

export const useUi = create<UiState>()((set, get) => ({
  ...parsePath(window.location.pathname),
  theme: readTheme(),
  locale: readLocale(),

  navigate(view, param = null) {
    pushPath(pathFor(view, param));
    set({ view, param });
  },
  openDetail(view, id) {
    pushPath(pathFor(view, id));
    set({ view, param: id });
  },
  closeDetail() {
    const { view } = get();
    if (view === 'users' || view === 'games') {
      pushPath(pathFor(view));
      set({ param: null });
    }
  },
  syncFromUrl() {
    set(parsePath(window.location.pathname));
  },
  setTheme(theme) {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
  setLocale(locale) {
    void i18n.changeLanguage(locale);
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* storage unavailable */
    }
    set({ locale });
  },
}));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/admin test --run ui.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full admin test suite and typecheck**

Run: `yarn workspace @trm/admin test --run` then `yarn workspace @trm/admin typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/store/ui.ts apps/admin/src/store/ui.test.ts
git commit -m "refactor(admin): drop the retired /admin/login route"
```

---

### Task 6: `apps/admin` — remove dead login code from `rest.ts`, i18n, and CSS

**Files:**
- Modify: `apps/admin/src/net/rest.ts:14-17,228-232,234-239`
- Modify: `apps/admin/src/i18n/index.ts` (the `login` block in both `zhHant` and `en`)
- Modify: `apps/admin/src/styles/admin.css:694-720`

**Interfaces:** none (pure removal; no other task depends on these symbols after Tasks
3–4 landed).

- [ ] **Step 1: Remove the dead auth-login code from `rest.ts`**

In `apps/admin/src/net/rest.ts`, remove this interface (currently lines 14-17):

```ts
export interface AuthResult {
  user: PublicUser;
  accessToken: string;
}
```

Remove this function (currently lines 228-232):

```ts
function captureToken(r: AuthResult): AuthResult {
  setAccessToken(r.accessToken);
  onToken?.(r.accessToken);
  return r;
}
```

Change the start of the `api` object (currently lines 234-239):

```ts
export const api = {
  // Existing auth endpoints (shared with the game app; same cookie).
  login: (email: string, password: string) =>
    req<AuthResult>('POST', '/auth/login', { email, password }).then(captureToken),
  me: () => req<PublicUser>('GET', '/auth/me'),
  logout: () => req<void>('POST', '/auth/logout').then(() => setAccessToken(null)),
```

to:

```ts
export const api = {
  // Existing auth endpoints (shared with the game app; same cookie). Admin never signs
  // in directly — it only restores a session via the shared refresh cookie (api.me()'s
  // 401→refresh path) or clears one (logout).
  me: () => req<PublicUser>('GET', '/auth/me'),
  logout: () => req<void>('POST', '/auth/logout').then(() => setAccessToken(null)),
```

- [ ] **Step 2: Remove the orphaned `login.*` i18n keys**

In `apps/admin/src/i18n/index.ts`, remove this block from the `zhHant` object:

```ts
  login: {
    title: '維運後台登入',
    email: '電子郵件',
    password: '密碼',
    submit: '登入',
    oauthHint: '使用 Google / Discord 帳號?請先在主站登入,再回到此頁重新整理。',
    openMain: '前往主站登入',
  },
```

And this block from the `en` object:

```ts
  login: {
    title: 'Maintainer sign-in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    oauthHint: 'Using Google / Discord? Sign in on the main app first, then reload this page.',
    openMain: 'Open the main app',
  },
```

- [ ] **Step 3: Remove the orphaned login-form CSS rules**

In `apps/admin/src/styles/admin.css`, remove these three rules (the `.oc-gate` and
`.oc-gate-card` rules right above them stay — `DeniedView` still uses those classes):

```css
.oc-gate-card .oc-brand {
  padding: 0;
  margin-bottom: var(--oc-space-6);
}

.oc-gate-card form {
  display: flex;
  flex-direction: column;
  gap: var(--oc-space-3);
}

.oc-gate-card .error {
  color: var(--oc-signal-stop);
  font-size: 12px;
}

.oc-gate-card .alt {
  margin-top: var(--oc-space-4);
  font-size: 12px;
  color: var(--oc-ink-soft);
}
```

- [ ] **Step 4: Run the full admin test suite, typecheck, and lint**

Run: `yarn workspace @trm/admin test --run`, `yarn workspace @trm/admin typecheck`,
`yarn workspace @trm/admin lint`
Expected: all PASS (this step is pure dead-code removal; no behavior changes, so no new
tests are added).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/i18n/index.ts apps/admin/src/styles/admin.css
git commit -m "chore(admin): remove dead login-form code, copy, and styles"
```

---

### Task 7: Full verification and manual cross-app smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run both workspaces' full test suites**

Run: `yarn workspace @trm/web test --run`
Expected: PASS, no regressions.

Run: `yarn workspace @trm/admin test --run`
Expected: PASS, no regressions.

- [ ] **Step 2: Typecheck and lint the whole repo**

Run: `yarn typecheck`
Expected: PASS across all workspaces.

Run: `yarn lint`
Expected: PASS, no new violations.

- [ ] **Step 3: Production build both apps**

Run: `yarn workspace @trm/web build` then `yarn workspace @trm/admin build`
Expected: both build cleanly (this also validates there's no leftover reference to the
deleted `LoginView.tsx` or removed i18n/CSS that a dev-only path might have hidden).

- [ ] **Step 4: Manual smoke test — the actual redirect loop in dev**

This exercises the real cross-app hand-off end to end, which the unit tests only cover
piecewise (each side is tested in isolation with the other side mocked).

1. Start Mongo: `docker compose up -d mongo`
2. Start the server: `yarn workspace @trm/server dev` (port 3001)
3. Start the web app: `yarn workspace @trm/web dev` (port 5173)
4. Start the admin app: `yarn workspace @trm/admin dev` (port 5174)
5. In a browser with no existing session (fresh/incognito window), visit
   `http://localhost:5174/admin/users`.
   - Expected: immediately redirected to
     `http://localhost:5173/login?redirect=%2Fadmin%2Fusers`, showing the main app's
     login screen (guest/login/register tabs + any enabled OAuth), NOT a local admin
     login form.
6. Sign in with an account that has a `dashboardAccounts` record (or seed one via
   `DASHBOARD_OWNER_EMAILS` per `apps/server`'s env docs).
   - Expected: the browser lands back on `http://localhost:5174/admin/users` (the exact
     page originally requested), showing the dashboard shell — not the admin overview,
     not the web app's home screen.
7. Click "Sign out" in the admin nav rail.
   - Expected: redirected to `http://localhost:5173/login?redirect=%2Fadmin%2Fusers` (or
     whichever admin page you were on) again.
8. Repeat step 5 while already signed in to the main app in the same browser (e.g. after
   re-logging in on `:5173` directly first, then navigating to `:5174/admin`).
   - Expected: no login form is shown at all — the browser bounces through
     `:5173/login?redirect=...` and straight back to `:5174/admin` invisibly.

- [ ] **Step 5: Report results**

No commit for this task — it's verification only. If any step fails, return to the
relevant earlier task to fix it before considering this plan complete.

## Self-Review Notes

- **Spec coverage:** every section of
  `docs/superpowers/specs/2026-07-04-admin-login-redirect-design.md` maps to a task —
  web's `navigateAfterAuth` (Task 1), admin's helper + redirect wiring (Tasks 2-3),
  `LoginView` removal (Task 4), router cleanup (Task 5), dead-code cleanup (Task 6), and
  the explicitly-unchanged `DeniedView`/server/web-UI items are left untouched throughout.
- **Placeholder scan:** no TBDs; every step shows complete code or an exact command with
  its expected result.
- **Type consistency:** `goToMainLogin(returnTo: string): void` and
  `mainLoginUrl(returnTo: string): string` (Task 2) are used with the same signature in
  Task 3 (`session.ts`) and Task 4 (`App.test.tsx`'s mock). `isAdminTarget(target:
  string): boolean` and `goToAdmin(target: string): void` (Task 1) are used consistently
  within Task 1 only. `SessionPhase` and the trimmed `SessionState` (Task 3) match how
  Task 4's `App.tsx` already consumes `session.phase`.
