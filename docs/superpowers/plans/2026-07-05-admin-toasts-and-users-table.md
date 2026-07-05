# Admin Action Toasts + Users Table Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toast notification system to `apps/admin` covering every mutation (fixing 4 sites that fail completely silently today), and add OAuth-method + guest-expiration columns to the Users table with a shared debounced-search hook.

**Architecture:** A new zustand `store/toast.ts` + `components/ToastStack.tsx` mirror the existing `apps/web` `NotificationStack` pattern (top-center pill stack, hold-then-fade) using admin's own `--oc-*` tokens. Two new backend-projected fields (`hasPassword`, `guestExpiresAt`) flow from `UserDoc` → `toRow()` → zod schema → `UserRow` → a new `OAuthBadges` component and an inline `ExpiresCell` helper in `UsersView`. A generic `useDebouncedValue` hook replaces two copy-pasted `setTimeout`-in-`useEffect` snippets.

**Tech Stack:** React 19 + TypeScript, zustand, react-i18next, vitest + @testing-library/react (frontend); NestJS + zod + nestjs-zod, vitest + supertest (backend). No new dependencies.

## Global Constraints

- No new dependency — no toast/notification library, no icon library (lucide-react's `KeyRound` + two hand-rolled inline SVGs cover the icons needed).
- All new CSS classes use the existing `oc-` prefix; reuse existing `--oc-*` tokens (`--oc-signal-clear`, `--oc-signal-stop`, `--oc-space-*`, `--oc-shadow`) — introduce no new tokens.
- All new i18n keys go into **both** `zhHant` and `en` objects in `apps/admin/src/i18n/index.ts`, keeping the same key tree (zh-Hant is primary, en is fallback).
- Logout (`store/session.ts`) is explicitly out of scope for toast coverage — its error swallow is intentional and stays as-is.
- `hasPassword` is a derived boolean only — `passwordHash` itself must never reach the dashboard wire (existing test at `apps/server/test/dashboard-read.e2e.spec.ts:173` already guards this).
- Any test that asserts on toast text must render `<ToastStack />` alongside the component under test — toasts are pushed to a global store but only `<ToastStack />` renders them; a test that only renders the view under test will never see the toast.
- Before considering any task done: the task's own test command passes. Before the whole plan is done: `yarn workspace @trm/admin test`, `yarn workspace @trm/admin typecheck`, `yarn workspace @trm/admin lint`, `yarn workspace @trm/server test`, `yarn workspace @trm/server typecheck` all pass.
- Commit after each task with a focused message — do not bundle unrelated tasks into one commit. Do not use `git add -A`/`git add .` (other sessions may be working in this worktree) — stage only the files each task actually touches.

---

### Task 1: `useDebouncedValue` hook

**Files:**
- Create: `apps/admin/src/hooks/useDebouncedValue.ts`
- Test: `apps/admin/src/hooks/useDebouncedValue.test.ts`

**Interfaces:**
- Produces: `useDebouncedValue<T>(value: T, delayMs: number): T` — a generic hook returning `value` after it has been stable for `delayMs`. Used by Task 8.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/hooks/useDebouncedValue.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('returns the debounced value only after the delay elapses', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: 'a' },
      });
      expect(result.current).toBe('a');

      rerender({ value: 'ab' });
      expect(result.current).toBe('a'); // not yet — delay hasn't elapsed

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe('ab');
    } finally {
      vi.useRealTimers();
    }
  });

  it('only applies the last of several rapid changes', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
        initialProps: { value: 'a' },
      });

      rerender({ value: 'ab' });
      act(() => {
        vi.advanceTimersByTime(150); // less than the delay
      });
      rerender({ value: 'abc' }); // supersedes the pending 'ab' update

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current).toBe('abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies a zero delay on the same tick', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 0), {
        initialProps: { value: '' },
      });
      rerender({ value: 'x' });
      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(result.current).toBe('x');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test useDebouncedValue`
Expected: FAIL — `Cannot find module './useDebouncedValue'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/admin/src/hooks/useDebouncedValue.ts
import { useEffect, useState } from 'react';

/** Returns `value`, updated only after it has been stable for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test useDebouncedValue`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/hooks/useDebouncedValue.ts apps/admin/src/hooks/useDebouncedValue.test.ts
git commit -m "feat(admin): add useDebouncedValue hook"
```

---

### Task 2: Toast store + `ToastStack` component, mounted in `App.tsx`

**Files:**
- Create: `apps/admin/src/store/toast.ts`
- Create: `apps/admin/src/components/ToastStack.tsx`
- Test: `apps/admin/src/components/ToastStack.test.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/styles/admin.css`

**Interfaces:**
- Produces: `useToast` (zustand store) with state `{ toasts: ToastCue[] }` and actions
  `push(kind: 'success' | 'error', message: string): void`, `remove(id: number): void`,
  `reset(): void`; type `ToastCue = { id: number; kind: 'success' | 'error'; message: string }`.
  Used by Tasks 6, 9, 10, 11, 12 as `const pushToast = useToast((s) => s.push);`.
- Produces: `<ToastStack />` component (no props), renders the current toasts. Any test that
  asserts on toast text must render this alongside the component under test.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/components/ToastStack.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '../i18n';
import { useToast } from '../store/toast';
import { ToastStack } from './ToastStack';

describe('ToastStack', () => {
  beforeEach(() => {
    useToast.getState().reset();
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastStack />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a pushed toast with its kind class', () => {
    useToast.getState().push('success', '已停權');
    render(<ToastStack />);
    expect(screen.getByText('已停權')).toHaveClass('oc-toast-chip--success');
  });

  it('stacks multiple concurrent toasts in push order', () => {
    useToast.getState().push('success', 'first');
    useToast.getState().push('error', 'second');
    render(<ToastStack />);
    const chips = screen.getAllByRole('status');
    expect(chips.map((c) => c.textContent)).toEqual(['first', 'second']);
  });

  it('auto-dismisses a success toast after its hold time, then removes it after the exit fade', () => {
    vi.useFakeTimers();
    try {
      useToast.getState().push('success', 'saved');
      render(<ToastStack />);
      expect(screen.getByText('saved')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2500); // success HOLD_MS
      });
      expect(screen.getByText('saved')).toHaveClass('oc-toast-chip--exit');

      act(() => {
        vi.advanceTimersByTime(200); // EXIT_MS
      });
      expect(screen.queryByText('saved')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('holds an error toast longer than a success toast before exiting', () => {
    vi.useFakeTimers();
    try {
      useToast.getState().push('error', 'failed');
      render(<ToastStack />);

      act(() => {
        vi.advanceTimersByTime(2500); // would have exited a success toast
      });
      expect(screen.getByText('failed')).not.toHaveClass('oc-toast-chip--exit');

      act(() => {
        vi.advanceTimersByTime(1500); // total 4000ms — error HOLD_MS
      });
      expect(screen.getByText('failed')).toHaveClass('oc-toast-chip--exit');
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test ToastStack`
Expected: FAIL — `Cannot find module '../store/toast'`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/admin/src/store/toast.ts
import { create } from 'zustand';

export type ToastKind = 'success' | 'error';

export interface ToastCue {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: ToastCue[];
  push(kind: ToastKind, message: string): void;
  remove(id: number): void;
  reset(): void;
}

let counter = 0;
const nextId = (): number => ++counter;

export const useToast = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, message) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId(), kind, message }] })),
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((c) => c.id !== id) })),
  reset: () => set({ toasts: [] }),
}));
```

```tsx
// apps/admin/src/components/ToastStack.tsx
import { useEffect, useState } from 'react';
import { useToast, type ToastCue } from '../store/toast';

const EXIT_MS = 200;
const HOLD_MS: Record<ToastCue['kind'], number> = {
  success: 2500,
  error: 4000,
};

function ToastChip({ cue }: { cue: ToastCue }) {
  const remove = useToast((s) => s.remove);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const holdId = window.setTimeout(() => setExiting(true), HOLD_MS[cue.kind]);
    return () => clearTimeout(holdId);
  }, [cue.kind]);

  useEffect(() => {
    if (!exiting) return;
    const exitId = window.setTimeout(() => remove(cue.id), EXIT_MS);
    return () => clearTimeout(exitId);
  }, [exiting, cue.id, remove]);

  const cls = ['oc-toast-chip', `oc-toast-chip--${cue.kind}`, exiting && 'oc-toast-chip--exit']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="status">
      {cue.message}
    </div>
  );
}

/** The stacked, self-expiring success/error toasts for every admin mutation. */
export function ToastStack() {
  const toasts = useToast((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="oc-toast-stack">
      {toasts.map((c) => (
        <ToastChip key={c.id} cue={c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test ToastStack`
Expected: PASS (5 tests)

- [ ] **Step 5: Add the toast CSS**

Append to `apps/admin/src/styles/admin.css` (after the `/* ---- misc ---- */` block at the end of the file):

```css
/* ---- toast stack --------------------------------------------------------------------- */

.oc-toast-stack {
  position: fixed;
  top: var(--oc-space-4);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--oc-space-2);
  z-index: 61;
  pointer-events: none;
}

.oc-toast-chip {
  padding: var(--oc-space-2) var(--oc-space-4);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: var(--oc-shadow);
  color: #fff;
  animation: oc-toast-in 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.oc-toast-chip.oc-toast-chip--exit {
  animation: oc-toast-out 200ms ease-in forwards;
}

@keyframes oc-toast-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes oc-toast-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(-10px) scale(0.96);
  }
}

.oc-toast-chip--success {
  background: var(--oc-signal-clear);
}
.oc-toast-chip--error {
  background: var(--oc-signal-stop);
}
```

(The existing global `@media (prefers-reduced-motion: reduce)` rule near the top of `admin.css`
already disables all animations, including these — no new media query needed.)

- [ ] **Step 6: Mount `ToastStack` in `App.tsx`**

In `apps/admin/src/App.tsx`, add the import alongside the other view imports:

```tsx
import { AuditView } from './views/AuditView';
import { ToastStack } from './components/ToastStack';
```

Then render it as the last child of the shell, replacing:

```tsx
      <main className="oc-main">
        <ActiveView view={view} />
      </main>
    </div>
  );
}
```

with:

```tsx
      <main className="oc-main">
        <ActiveView view={view} />
      </main>
      <ToastStack />
    </div>
  );
}
```

- [ ] **Step 7: Run the full admin test suite to confirm nothing broke**

Run: `yarn workspace @trm/admin test`
Expected: PASS (all existing suites plus the 5 new `ToastStack` tests)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/store/toast.ts apps/admin/src/components/ToastStack.tsx apps/admin/src/components/ToastStack.test.tsx apps/admin/src/App.tsx apps/admin/src/styles/admin.css
git commit -m "feat(admin): add toast notification system"
```

---

### Task 3: i18n additions (toast messages + new column/badge strings)

**Files:**
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**
- Produces: i18n keys consumed by Tasks 5, 6, 7, 9, 10, 11, 12 —
  `toast.userBanned`, `toast.userUnbanned`, `toast.featuresSaved`, `toast.gameTerminated`,
  `toast.roomClosed`, `toast.maintainerSaved`, `toast.maintainerRevoked`,
  `users.colOauth`, `users.colExpires`, `users.oauthGoogle`, `users.oauthDiscord`,
  `users.oauthPassword`, `users.expiresDisabledSuffix`.

- [ ] **Step 1: Add the new keys to `zhHant`**

In `apps/admin/src/i18n/index.ts`, add a new top-level `toast` object to the `zhHant` object
(insert it right after the `signal: { ... }` line):

```ts
  toast: {
    userBanned: '帳號已停權',
    userUnbanned: '已解除停權',
    featuresSaved: '功能開通已儲存',
    gameTerminated: '對局已強制終止',
    roomClosed: '房間已關閉',
    maintainerSaved: '維護者權限已儲存',
    maintainerRevoked: '維護者權限已撤銷',
  },
```

Then, inside the existing `users: { ... }` object in `zhHant`, add two new column-header keys
(alongside the existing `colUser`/`colEmail`/`colKind`/`colCreated`/`colStatus` group):

```ts
    colOauth: '登入方式',
    colExpires: '到期時間',
```

and three badge-label keys plus the disabled-suffix key (alongside `oauth`/`locale`):

```ts
    oauthGoogle: 'Google',
    oauthDiscord: 'Discord',
    oauthPassword: '密碼',
    expiresDisabledSuffix: '（已停權）',
```

- [ ] **Step 2: Add the matching keys to `en`**

In the `en` object, add the same `toast` block:

```ts
  toast: {
    userBanned: 'Account disabled',
    userUnbanned: 'Account re-enabled',
    featuresSaved: 'Feature access saved',
    gameTerminated: 'Game force-terminated',
    roomClosed: 'Room closed',
    maintainerSaved: 'Maintainer access saved',
    maintainerRevoked: 'Maintainer access revoked',
  },
```

And inside `en.users`:

```ts
    colOauth: 'Sign-in',
    colExpires: 'Expires',
```

```ts
    oauthGoogle: 'Google',
    oauthDiscord: 'Discord',
    oauthPassword: 'Password',
    expiresDisabledSuffix: '(disabled)',
```

- [ ] **Step 3: Run typecheck (the `en` object is typed as `typeof zhHant`, so a missing key fails compilation)**

Run: `yarn workspace @trm/admin typecheck`
Expected: PASS

- [ ] **Step 4: Run the full admin test suite**

Run: `yarn workspace @trm/admin test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/i18n/index.ts
git commit -m "feat(admin): add i18n strings for action toasts and users table columns"
```

---

### Task 4: Backend — expose `hasPassword` and `guestExpiresAt` on dashboard user rows

**Files:**
- Modify: `apps/server/src/dashboard/dashboard-users.service.ts:22-32` (the `toRow` function)
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts:89-99` (`DashboardUserRowSchema`)
- Modify: `apps/admin/src/net/rest.ts:43-53` (`UserRow` interface)
- Test: `apps/server/test/dashboard-read.e2e.spec.ts` (extend the existing `describe('users', ...)` block)

**Interfaces:**
- Produces: every dashboard user row/detail payload gains `hasPassword: boolean` and an
  optional `guestExpiresAt?: string` (ISO timestamp, present only for guests with a pending
  TTL). Used by Task 7 (`OAuthBadges`, `ExpiresCell` in `UsersView`).

- [ ] **Step 1: Write the failing backend test**

Open `apps/server/test/dashboard-read.e2e.spec.ts` and add this test inside the existing
`describe('users', ...)` block (right after the `'search finds by displayName prefix...'` test,
before `'user detail includes sessions...'`):

```ts
  it('registered accounts report hasPassword; guest accounts report a pending guestExpiresAt', async () => {
    const all = await request(server())
      .get('/api/v1/dashboard/users')
      .set(auth(admin.token))
      .expect(200);
    const adminRow = all.body.users.find((u: { id: string }) => u.id === admin.userId);
    expect(adminRow.hasPassword).toBe(true);
    expect(adminRow.guestExpiresAt).toBeUndefined();

    const guests = await request(server())
      .get('/api/v1/dashboard/users?filter=guests')
      .set(auth(admin.token))
      .expect(200);
    const hostRow = guests.body.users.find((u: { id: string }) => u.id === host.userId);
    expect(hostRow.hasPassword).toBe(false);
    expect(typeof hostRow.guestExpiresAt).toBe('string');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test dashboard-read`
Expected: FAIL — `adminRow.hasPassword` is `undefined`, not `true`

- [ ] **Step 3: Update the backend projection**

In `apps/server/src/dashboard/dashboard-users.service.ts`, replace the `toRow` function:

```ts
const toRow = (u: UserDoc) => ({
  id: u._id,
  displayName: u.displayName,
  ...(u.email ? { email: u.email } : {}),
  isGuest: u.isGuest,
  ...(u.avatarUrl ? { avatarUrl: u.avatarUrl } : {}),
  oauthProviders: Object.keys(u.oauth ?? {}),
  features: u.features ?? [],
  createdAt: u.createdAt.toISOString(),
  ...(u.disabledAt ? { disabledAt: u.disabledAt.toISOString() } : {}),
});
```

with:

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
  createdAt: u.createdAt.toISOString(),
  ...(u.disabledAt ? { disabledAt: u.disabledAt.toISOString() } : {}),
  ...(u.guestExpiresAt ? { guestExpiresAt: u.guestExpiresAt.toISOString() } : {}),
});
```

- [ ] **Step 4: Update the zod schema**

In `apps/server/src/dashboard/dashboard.schemas.ts`, replace:

```ts
export const DashboardUserRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().optional(),
  isGuest: z.boolean(),
  avatarUrl: z.string().optional(),
  oauthProviders: z.array(z.string()),
  features: z.array(UserFeatureSchema),
  createdAt: z.string(),
  disabledAt: z.string().optional(),
});
```

with:

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
  createdAt: z.string(),
  disabledAt: z.string().optional(),
  guestExpiresAt: z.string().optional(),
});
```

(`DashboardUserDetailSchema` uses `.extend()` on this schema, so it inherits both new fields
automatically — no change needed there.)

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/server test dashboard-read`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 6: Update the frontend `UserRow` type**

In `apps/admin/src/net/rest.ts`, replace:

```ts
export interface UserRow {
  id: string;
  displayName: string;
  email?: string;
  isGuest: boolean;
  avatarUrl?: string;
  oauthProviders: string[];
  features: UserFeature[];
  createdAt: string;
  disabledAt?: string;
}
```

with:

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
  createdAt: string;
  disabledAt?: string;
  guestExpiresAt?: string;
}
```

(`UserDetail extends UserRow`, so it inherits both fields — no change needed there.)

- [ ] **Step 7: Run admin typecheck to confirm nothing else broke**

Run: `yarn workspace @trm/admin typecheck`
Expected: PASS. (Existing test fixtures like `AccountSelectorModal.test.tsx`'s `row()` helper
build a `UserRow` without `hasPassword` — since it's a required field, this **will** fail
typecheck. Fix each fixture helper by adding `hasPassword: false` to the object it spreads as
defaults:)

In `apps/admin/src/components/AccountSelectorModal.test.tsx`, change:

```ts
const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  isGuest: false,
  oauthProviders: [],
  features: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});
```

to:

```ts
const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  isGuest: false,
  oauthProviders: [],
  hasPassword: false,
  features: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});
```

In `apps/admin/src/views/FeaturesView.test.tsx`, change:

```ts
const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  features: ['mapBuilder'],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});
```

to:

```ts
const row = (over: Partial<UserRow> = {}): UserRow => ({
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  hasPassword: false,
  features: ['mapBuilder'],
  createdAt: '2026-07-01T00:00:00.000Z',
  ...over,
});
```

Re-run: `yarn workspace @trm/admin typecheck`
Expected: PASS

- [ ] **Step 8: Run the full admin and server test suites**

Run: `yarn workspace @trm/admin test && yarn workspace @trm/server test dashboard-read`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/dashboard/dashboard-users.service.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/test/dashboard-read.e2e.spec.ts apps/admin/src/net/rest.ts apps/admin/src/components/AccountSelectorModal.test.tsx apps/admin/src/views/FeaturesView.test.tsx
git commit -m "feat(server,admin): expose hasPassword and guestExpiresAt on dashboard user rows"
```

---

### Task 5: OAuth method badges (`OAuthBadges` + two glyph icons)

**Files:**
- Create: `apps/admin/src/components/icons/GoogleGlyph.tsx`
- Create: `apps/admin/src/components/icons/DiscordGlyph.tsx`
- Create: `apps/admin/src/components/OAuthBadges.tsx`
- Test: `apps/admin/src/components/OAuthBadges.test.tsx`

**Interfaces:**
- Consumes: i18n keys `users.oauthGoogle`, `users.oauthDiscord`, `users.oauthPassword` (Task 3).
- Produces: `<OAuthBadges oauthProviders={string[]} hasPassword={boolean} />`. Used by Task 7 in
  `UsersView.tsx` (table cell + drawer row).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/components/OAuthBadges.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../i18n';
import { OAuthBadges } from './OAuthBadges';

describe('OAuthBadges', () => {
  it('renders a dash when there are no linked sign-in methods', () => {
    render(<OAuthBadges oauthProviders={[]} hasPassword={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders one badge per linked provider plus a password badge', () => {
    render(<OAuthBadges oauthProviders={['google', 'discord']} hasPassword />);
    expect(screen.getByTitle('Google')).toBeInTheDocument();
    expect(screen.getByTitle('Discord')).toBeInTheDocument();
    expect(screen.getByTitle('密碼')).toBeInTheDocument();
  });

  it('omits the password badge for an OAuth-only, passwordless account', () => {
    render(<OAuthBadges oauthProviders={['google']} hasPassword={false} />);
    expect(screen.getByTitle('Google')).toBeInTheDocument();
    expect(screen.queryByTitle('密碼')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test OAuthBadges`
Expected: FAIL — `Cannot find module './OAuthBadges'`

- [ ] **Step 3: Write the glyph icons**

```tsx
// apps/admin/src/components/icons/GoogleGlyph.tsx
/** Monochrome Google mark (Simple Icons, MIT-licensed path data), sized/colored like lucide icons. */
export function GoogleGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.344-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z" />
    </svg>
  );
}
```

```tsx
// apps/admin/src/components/icons/DiscordGlyph.tsx
/** Monochrome Discord mark (Simple Icons, MIT-licensed path data), sized/colored like lucide icons. */
export function DiscordGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}
```

- [ ] **Step 4: Write `OAuthBadges`**

```tsx
// apps/admin/src/components/OAuthBadges.tsx
import type { ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GoogleGlyph } from './icons/GoogleGlyph';
import { DiscordGlyph } from './icons/DiscordGlyph';

interface Props {
  oauthProviders: string[];
  hasPassword: boolean;
}

/** Compact per-method badges for a user's linked sign-in methods. Each badge is icon-only
 *  with a `title`/`aria-label` tooltip — consistent with other dense cells in this table
 *  that rely on `title` rather than always inlining text (e.g. the drawer's ID field). */
export function OAuthBadges({ oauthProviders, hasPassword }: Props) {
  const { t } = useTranslation();
  const badges: { key: string; label: string; icon: ReactNode }[] = [];
  if (oauthProviders.includes('google')) {
    badges.push({ key: 'google', label: t('users.oauthGoogle'), icon: <GoogleGlyph /> });
  }
  if (oauthProviders.includes('discord')) {
    badges.push({ key: 'discord', label: t('users.oauthDiscord'), icon: <DiscordGlyph /> });
  }
  if (hasPassword) {
    badges.push({
      key: 'password',
      label: t('users.oauthPassword'),
      icon: <KeyRound size={14} aria-hidden />,
    });
  }
  if (badges.length === 0) return <span className="oc-muted">—</span>;
  return (
    <span className="oc-oauth-badges">
      {badges.map((b) => (
        <span key={b.key} className="oc-oauth-badge" title={b.label} aria-label={b.label}>
          {b.icon}
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 5: Add the badge CSS**

Append to `apps/admin/src/styles/admin.css`:

```css
/* ---- oauth badges --------------------------------------------------------------------- */

.oc-oauth-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.oc-oauth-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--oc-ink-soft);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/admin test OAuthBadges`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/icons/GoogleGlyph.tsx apps/admin/src/components/icons/DiscordGlyph.tsx apps/admin/src/components/OAuthBadges.tsx apps/admin/src/components/OAuthBadges.test.tsx apps/admin/src/styles/admin.css
git commit -m "feat(admin): add OAuth/password method badges"
```

---

### Task 6: Wire toasts into `UsersView` ban/unban (fixes the silent-failure bug)

**Files:**
- Modify: `apps/admin/src/views/UsersView.tsx:41-53` (`toggleBan`)
- Test: `apps/admin/src/views/UsersView.test.tsx` (new file)

**Interfaces:**
- Consumes: `useToast` (Task 2), i18n keys `toast.userBanned`/`toast.userUnbanned` (Task 3).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/views/UsersView.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { UsersView } from './UsersView';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { ToastStack } from '../components/ToastStack';

interface Route {
  status: number;
  body: unknown;
}
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

const USER_DETAIL = {
  id: 'u1',
  displayName: 'Alice',
  isGuest: false,
  oauthProviders: [],
  hasPassword: true,
  features: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  activeSessions: 0,
  activeRooms: [],
  history: [],
  isMaintainer: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useUi.setState({ view: 'users', param: 'u1' });
  useSession.setState({
    phase: 'ready',
    user: { id: 'admin1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['users.read', 'users.ban']),
  });
});

describe('UsersView ban/unban toasts', () => {
  it('shows a success toast after disabling a user', async () => {
    stubFetch({
      '/dashboard/users/u1': { status: 200, body: USER_DETAIL },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    // '停權' is also the label of the "Disabled" filter tab in the toolbar, and it renders
    // synchronously before the drawer's async detail loads — so scope the trigger click to
    // the drawer (named "Alice") to avoid matching the tab instead.
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('停權'));
    // The drawer itself and the confirm dialog both have role="dialog", and the trigger
    // button shares its label ('停權') with the dialog's confirm button — so target the
    // confirm dialog specifically by its own title (aria-label) to avoid any ambiguity.
    const dialog = await screen.findByRole('dialog', { name: '停權此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '停權' }));
    expect(await screen.findByText('帳號已停權')).toBeInTheDocument();
  });

  it('shows an error toast when disabling fails (a request that previously failed silently)', async () => {
    stubFetch({
      '/dashboard/users/u1/disable': { status: 500, body: { message: 'boom' } },
      '/dashboard/users/u1': { status: 200, body: USER_DETAIL },
      '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } },
    });
    render(
      <>
        <UsersView />
        <ToastStack />
      </>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Alice' });
    fireEvent.click(within(drawer).getByText('停權'));
    const dialog = await screen.findByRole('dialog', { name: '停權此帳號?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '停權' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test UsersView`
Expected: FAIL — no toast text found (the mutation currently has no `catch`, so a 500 throws
unhandled, and neither test's expected text ever appears)

- [ ] **Step 3: Wire the toast into `toggleBan`**

In `apps/admin/src/views/UsersView.tsx`, add the import:

```tsx
import { useToast } from '../store/toast';
```

Inside `UserDrawer`, add the hook alongside the other store hooks:

```tsx
  const pushToast = useToast((s) => s.push);
```

Replace:

```tsx
  const toggleBan = async (reason?: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      const next = detail.disabledAt
        ? await api.enableUser(detail.id)
        : await api.disableUser(detail.id, reason);
      setDetail(next);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
```

with:

```tsx
  const toggleBan = async (reason?: string) => {
    if (!detail) return;
    const wasBanned = Boolean(detail.disabledAt);
    setBusy(true);
    try {
      const next = wasBanned
        ? await api.enableUser(detail.id)
        : await api.disableUser(detail.id, reason);
      setDetail(next);
      pushToast('success', t(wasBanned ? 'toast.userUnbanned' : 'toast.userBanned'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test UsersView`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/views/UsersView.tsx apps/admin/src/views/UsersView.test.tsx
git commit -m "fix(admin): surface success/error toasts on user ban/unban"
```

---

### Task 7: `UsersView` — OAuth and Expires columns (table + drawer)

**Files:**
- Modify: `apps/admin/src/views/UsersView.tsx`

**Interfaces:**
- Consumes: `<OAuthBadges />` (Task 5), `UserRow.hasPassword`/`guestExpiresAt` (Task 4),
  `users.colOauth`/`colExpires`/`expiresDisabledSuffix` (Task 3).

- [ ] **Step 1: Write the failing test (extends `UsersView.test.tsx` from Task 6)**

Add to `apps/admin/src/views/UsersView.test.tsx`, a new `describe` block:

```tsx
describe('UsersView columns', () => {
  it('renders OAuth badges and an expiry timestamp for a disabled guest', async () => {
    useUi.setState({ view: 'users', param: null });
    stubFetch({
      '/dashboard/users?': {
        status: 200,
        body: {
          users: [
            {
              id: 'g1',
              displayName: 'Guest One',
              isGuest: true,
              oauthProviders: ['google'],
              hasPassword: false,
              features: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              disabledAt: '2026-01-02T00:00:00.000Z',
              guestExpiresAt: '2026-07-12T03:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      },
    });
    render(<UsersView />);
    expect(await screen.findByTitle('Google')).toBeInTheDocument();
    expect(screen.getByText('（已停權）')).toBeInTheDocument();
  });

  it('renders a dash in the Expires column for a registered account', async () => {
    useUi.setState({ view: 'users', param: null });
    stubFetch({
      '/dashboard/users?': {
        status: 200,
        body: {
          users: [
            {
              id: 'r1',
              displayName: 'Reg One',
              isGuest: false,
              oauthProviders: [],
              hasPassword: true,
              features: [],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      },
    });
    render(<UsersView />);
    expect(await screen.findByTitle('密碼')).toBeInTheDocument();
    // Two dashes expected: Email column ("—") and Expires column ("—").
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test UsersView`
Expected: FAIL — no element with title `Google`/`密碼` (columns don't exist yet)

- [ ] **Step 3: Add the `ExpiresCell` helper and update imports**

In `apps/admin/src/views/UsersView.tsx`, add the import:

```tsx
import { OAuthBadges } from '../components/OAuthBadges';
```

Add this helper function above `UserDrawer` (after the existing `FILTER_KEY` constant):

```tsx
function ExpiresCell({
  guestExpiresAt,
  disabledAt,
  locale,
}: {
  guestExpiresAt?: string;
  disabledAt?: string;
  locale: string;
}) {
  const { t } = useTranslation();
  if (!guestExpiresAt) return <span className="oc-muted">—</span>;
  return (
    <>
      {fmtDateTime(guestExpiresAt, locale)}
      {disabledAt && <span className="oc-muted"> {t('users.expiresDisabledSuffix')}</span>}
    </>
  );
}
```

- [ ] **Step 4: Update the table header row**

Replace:

```tsx
            <tr>
              <th>{t('users.colUser')}</th>
              <th>{t('users.colEmail')}</th>
              <th>{t('users.colKind')}</th>
              <th>{t('users.colCreated')}</th>
              <th>{t('users.colStatus')}</th>
            </tr>
```

with (new order: User / Email / Kind / OAuth / Status / Created / Expires):

```tsx
            <tr>
              <th>{t('users.colUser')}</th>
              <th>{t('users.colEmail')}</th>
              <th>{t('users.colKind')}</th>
              <th>{t('users.colOauth')}</th>
              <th>{t('users.colStatus')}</th>
              <th>{t('users.colCreated')}</th>
              <th>{t('users.colExpires')}</th>
            </tr>
```

- [ ] **Step 5: Update the table body row**

Replace:

```tsx
            {rows.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => openDetail('users', u.id)}>
                <td>
                  {u.displayName} <span className="oc-mono oc-muted">{shortId(u.id)}</span>
                </td>
                <td>{u.email ?? <span className="oc-muted">—</span>}</td>
                <td>{u.isGuest ? t('users.guest') : t('users.registered')}</td>
                <td className="num">{fmtDateTime(u.createdAt, locale)}</td>
                <td>
                  {u.disabledAt ? (
                    <SignalBadge aspect="stop" label={t('users.disabledBadge')} />
                  ) : (
                    <SignalBadge aspect="clear" label={t('users.active')} />
                  )}
                </td>
              </tr>
            ))}
```

with:

```tsx
            {rows.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => openDetail('users', u.id)}>
                <td>
                  {u.displayName} <span className="oc-mono oc-muted">{shortId(u.id)}</span>
                </td>
                <td>{u.email ?? <span className="oc-muted">—</span>}</td>
                <td>{u.isGuest ? t('users.guest') : t('users.registered')}</td>
                <td>
                  <OAuthBadges oauthProviders={u.oauthProviders} hasPassword={u.hasPassword} />
                </td>
                <td>
                  {u.disabledAt ? (
                    <SignalBadge aspect="stop" label={t('users.disabledBadge')} />
                  ) : (
                    <SignalBadge aspect="clear" label={t('users.active')} />
                  )}
                </td>
                <td className="num">{fmtDateTime(u.createdAt, locale)}</td>
                <td className="num">
                  <ExpiresCell
                    guestExpiresAt={u.guestExpiresAt}
                    disabledAt={u.disabledAt}
                    locale={locale}
                  />
                </td>
              </tr>
            ))}
```

- [ ] **Step 6: Update the drawer's OAuth row and add an Expires row**

Replace:

```tsx
            {detail.oauthProviders.length > 0 && (
              <div className="oc-kv">
                <span className="k">{t('users.oauth')}</span>
                <span className="v">{detail.oauthProviders.join(', ')}</span>
              </div>
            )}
```

with:

```tsx
            {(detail.oauthProviders.length > 0 || detail.hasPassword) && (
              <div className="oc-kv">
                <span className="k">{t('users.oauth')}</span>
                <span className="v">
                  <OAuthBadges
                    oauthProviders={detail.oauthProviders}
                    hasPassword={detail.hasPassword}
                  />
                </span>
              </div>
            )}
            {detail.isGuest && detail.guestExpiresAt && (
              <div className="oc-kv">
                <span className="k">{t('users.colExpires')}</span>
                <span className="v">
                  <ExpiresCell
                    guestExpiresAt={detail.guestExpiresAt}
                    disabledAt={detail.disabledAt}
                    locale={locale}
                  />
                </span>
              </div>
            )}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/admin test UsersView`
Expected: PASS (4 tests total: the 2 from Task 6 plus the 2 new ones)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/views/UsersView.tsx apps/admin/src/views/UsersView.test.tsx
git commit -m "feat(admin): add OAuth and Expires columns to the users table"
```

---

### Task 8: Switch `UsersView` and `AccountSelectorModal` to `useDebouncedValue`

**Files:**
- Modify: `apps/admin/src/views/UsersView.tsx:203-230`
- Modify: `apps/admin/src/components/AccountSelectorModal.tsx:26-53`

**Interfaces:**
- Consumes: `useDebouncedValue` (Task 1).

- [ ] **Step 1: Write the failing test (extends `UsersView.test.tsx`)**

Add to `apps/admin/src/views/UsersView.test.tsx`:

```tsx
describe('UsersView search debounce', () => {
  it('debounces typed search input by 300ms before calling the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useUi.setState({ view: 'users', param: null });
      stubFetch({ '/dashboard/users?': { status: 200, body: { users: [], nextCursor: null } } });
      const fetchSpy = vi.mocked(fetch);
      render(<UsersView />);
      await screen.findByPlaceholderText('搜尋 ID、電子郵件或名稱…');
      const callsBeforeTyping = fetchSpy.mock.calls.length;

      fireEvent.change(screen.getByPlaceholderText('搜尋 ID、電子郵件或名稱…'), {
        target: { value: 'alice' },
      });
      // Not yet — under the 300ms debounce delay.
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(fetchSpy.mock.calls.length).toBe(callsBeforeTyping);

      await act(async () => {
        vi.advanceTimersByTime(150); // total 350ms, past the 300ms debounce
      });
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBeforeTyping);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Add `act` to the existing `@testing-library/react` import at the top of the file (it already
has `within` from Task 6):

```tsx
import { render, screen, fireEvent, within, act } from '@testing-library/react';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test UsersView`
Expected: FAIL — the current implementation debounces at 250ms via its own inline `setTimeout`;
the test's 200ms/150ms split straddles the new 300ms line, not the old 250ms line, so it won't
pass until Step 3 lands.

- [ ] **Step 3: Update `UsersView.tsx`**

Add the import:

```tsx
import { useDebouncedValue } from '../hooks/useDebouncedValue';
```

Replace:

```tsx
  const [rows, setRows] = useState<UserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<UserFilter>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listUsers({
          ...(q.trim() ? { q: q.trim() } : {}),
          filter,
          ...(append ? { cursor: append } : {}),
        });
        setRows((prev) => (append ? [...prev, ...page.users] : page.users));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [filter, q],
  );

  useEffect(() => {
    const id = setTimeout(() => void load(null), q ? 250 : 0); // debounce typing
    return () => clearTimeout(id);
  }, [load, q]);
```

with:

```tsx
  const [rows, setRows] = useState<UserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<UserFilter>('all');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, q.trim() ? 300 : 0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listUsers({
          ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
          filter,
          ...(append ? { cursor: append } : {}),
        });
        setRows((prev) => (append ? [...prev, ...page.users] : page.users));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [filter, debouncedQ],
  );

  useEffect(() => {
    void load(null);
  }, [load]);
```

- [ ] **Step 4: Update `AccountSelectorModal.tsx`**

Add the import:

```tsx
import { useDebouncedValue } from '../hooks/useDebouncedValue';
```

Replace:

```tsx
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(
      () => {
        setLoading(true);
        api
          .listUsers({ ...(q.trim() ? { q: q.trim() } : {}), filter })
          .then((page) => {
            if (!cancelled) setRows(page.users);
          })
          .catch(() => {
            if (!cancelled) setRows([]);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      q ? 250 : 0,
    ); // debounce typing, load immediately on open
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, filter]);
```

with:

```tsx
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, q.trim() ? 300 : 0);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listUsers({ ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}), filter })
      .then((page) => {
        if (!cancelled) setRows(page.users);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, filter]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/admin test UsersView AccountSelectorModal`
Expected: PASS (all tests in both files)

- [ ] **Step 6: Run the full admin suite**

Run: `yarn workspace @trm/admin test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/views/UsersView.tsx apps/admin/src/components/AccountSelectorModal.tsx apps/admin/src/views/UsersView.test.tsx
git commit -m "refactor(admin): extract shared useDebouncedValue hook for search inputs"
```

---

### Task 9: Wire toast into `FeatureToggles` save

**Files:**
- Modify: `apps/admin/src/components/FeatureToggles.tsx`
- Test: `apps/admin/src/components/FeatureToggles.test.tsx` (new file)

**Interfaces:**
- Consumes: `useToast` (Task 2), `toast.featuresSaved` (Task 3).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/components/FeatureToggles.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as RestModule from '../net/rest';
import { render, screen, fireEvent } from '@testing-library/react';
import '../i18n';
import { FeatureToggles } from './FeatureToggles';
import { api } from '../net/rest';
import { useToast } from '../store/toast';
import { ToastStack } from './ToastStack';

vi.mock('../net/rest', async (importOriginal) => {
  const mod = await importOriginal<typeof RestModule>();
  return { ...mod, api: { ...mod.api, putUserFeatures: vi.fn() } };
});
const mocked = api as unknown as { putUserFeatures: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
});

describe('FeatureToggles toasts', () => {
  it('shows a success toast after saving', async () => {
    mocked.putUserFeatures.mockResolvedValue({ id: 'u1', features: ['mapBuilder'] });
    render(
      <>
        <FeatureToggles userId="u1" initial={[]} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('功能開通已儲存')).toBeInTheDocument();
  });

  it('shows an error toast when saving fails', async () => {
    mocked.putUserFeatures.mockRejectedValue(new Error('boom'));
    render(
      <>
        <FeatureToggles userId="u1" initial={[]} />
        <ToastStack />
      </>,
    );
    fireEvent.click(screen.getByText('儲存'));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test FeatureToggles`
Expected: FAIL — no toast text rendered (the mutation has no success toast yet, and the error
path only sets local inline error state)

- [ ] **Step 3: Wire the toast into `save`**

In `apps/admin/src/components/FeatureToggles.tsx`, add the import:

```tsx
import { useToast } from '../store/toast';
```

Add the hook inside the component:

```tsx
  const pushToast = useToast((s) => s.push);
```

Replace:

```tsx
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const detail = await api.putUserFeatures(userId, [...selected]);
      onSaved?.(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setBusy(false);
    }
  };
```

with:

```tsx
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const detail = await api.putUserFeatures(userId, [...selected]);
      onSaved?.(detail);
      pushToast('success', t('toast.featuresSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test FeatureToggles`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/FeatureToggles.tsx apps/admin/src/components/FeatureToggles.test.tsx
git commit -m "feat(admin): surface success/error toasts on feature-access save"
```

---

### Task 10: Wire toast into `GamesView` terminate

**Files:**
- Modify: `apps/admin/src/views/GamesView.tsx:58-66`
- Modify: `apps/admin/src/views/GamesView.test.tsx` (extend)

**Interfaces:**
- Consumes: `useToast` (Task 2), `toast.gameTerminated` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `apps/admin/src/views/GamesView.test.tsx`, alongside the existing imports:

```tsx
import { ToastStack } from '../components/ToastStack';
import { useToast } from '../store/toast';
```

Update the existing `@testing-library/react` import to include `fireEvent` and `within`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
```

Add a new `describe` block:

```tsx
describe('GamesView terminate toasts', () => {
  beforeEach(() => {
    useToast.getState().reset();
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['games.read', 'games.terminate']),
    });
  });

  it('shows a success toast after terminating a live game', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/terminate': { status: 200, body: { ...GAME_DETAIL, status: 'TERMINATED' } },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('強制終止'));
    // The drawer itself and the confirm dialog both have role="dialog", and the trigger
    // button shares its label ('強制終止') with the dialog's confirm button — so target the
    // confirm dialog specifically by its own title (aria-label) to avoid any ambiguity.
    const dialog = await screen.findByRole('dialog', { name: '強制終止此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '強制終止' }));
    expect(await screen.findByText('對局已強制終止')).toBeInTheDocument();
  });

  it('shows an error toast when termination fails (previously an unhandled rejection)', async () => {
    useUi.setState({ view: 'games', param: 'g1' });
    stubFetch({
      '/dashboard/games/g1/terminate': { status: 500, body: { message: 'boom' } },
      '/dashboard/games/g1': { status: 200, body: { ...GAME_DETAIL, status: 'LIVE' } },
      '/dashboard/games?': { status: 200, body: { games: [], nextCursor: null } },
    });
    render(
      <>
        <GamesView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('強制終止'));
    const dialog = await screen.findByRole('dialog', { name: '強制終止此對局?' });
    fireEvent.click(within(dialog).getByRole('button', { name: '強制終止' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test GamesView`
Expected: FAIL — `terminate` has no `catch`, and no success toast exists yet

- [ ] **Step 3: Wire the toast into `terminate`**

In `apps/admin/src/views/GamesView.tsx`, add the import:

```tsx
import { useToast } from '../store/toast';
```

Inside `GameDrawer`, add the hook:

```tsx
  const pushToast = useToast((s) => s.push);
```

Replace:

```tsx
  const terminate = async (reason?: string) => {
    setBusy(true);
    try {
      setDetail(await api.terminateGame(id, reason));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
```

with:

```tsx
  const terminate = async (reason?: string) => {
    setBusy(true);
    try {
      setDetail(await api.terminateGame(id, reason));
      pushToast('success', t('toast.gameTerminated'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test GamesView`
Expected: PASS (3 tests total: the existing chat test plus the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/views/GamesView.tsx apps/admin/src/views/GamesView.test.tsx
git commit -m "fix(admin): surface success/error toasts on game termination"
```

---

### Task 11: Wire toast into `RoomsView` close

**Files:**
- Modify: `apps/admin/src/views/RoomsView.tsx:55-64`
- Test: `apps/admin/src/views/RoomsView.test.tsx` (new file)

**Interfaces:**
- Consumes: `useToast` (Task 2), `toast.roomClosed` (Task 3).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/views/RoomsView.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { RoomsView } from './RoomsView';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { ToastStack } from '../components/ToastStack';

interface Route {
  status: number;
  body: unknown;
}
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

const ROOM_ROW = {
  code: 'ABCD',
  hostId: 'h1',
  status: 'LOBBY',
  memberCount: 1,
  maxPlayers: 5,
  visibility: 'PUBLIC',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  members: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useUi.setState({ view: 'rooms', param: null });
  useSession.setState({
    phase: 'ready',
    user: { id: 'u1', displayName: 'Ops', isGuest: false },
    role: 'admin',
    permissions: new Set(['rooms.read', 'rooms.close']),
  });
});

describe('RoomsView close toasts', () => {
  it('shows a success toast after closing a room', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD/close': { status: 200, body: { ...ROOM_ROW, status: 'CLOSED' } },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('關閉房間'));
    // The trigger button and the confirm dialog's confirm button share the same label
    // ('關閉房間'), so scope the second click to the dialog to avoid an ambiguous match.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉房間' }));
    expect(await screen.findByText('房間已關閉')).toBeInTheDocument();
  });

  it('shows an error toast when closing fails (previously an unhandled rejection)', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD/close': { status: 500, body: { message: 'boom' } },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('關閉房間'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉房間' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test RoomsView`
Expected: FAIL — `close` has no `catch`, and no success toast exists yet

- [ ] **Step 3: Wire the toast into `close`**

In `apps/admin/src/views/RoomsView.tsx`, add the import:

```tsx
import { useToast } from '../store/toast';
```

Inside `RoomsView`, add the hook alongside the other store hooks:

```tsx
  const pushToast = useToast((s) => s.push);
```

Replace:

```tsx
  const close = async (code: string, reason?: string) => {
    setBusy(true);
    try {
      const updated = await api.closeRoom(code, reason);
      setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
    } finally {
      setBusy(false);
      setClosing(null);
    }
  };
```

with:

```tsx
  const close = async (code: string, reason?: string) => {
    setBusy(true);
    try {
      const updated = await api.closeRoom(code, reason);
      setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
      pushToast('success', t('toast.roomClosed'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setClosing(null);
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test RoomsView`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/views/RoomsView.tsx apps/admin/src/views/RoomsView.test.tsx
git commit -m "fix(admin): surface success/error toasts on room close"
```

---

### Task 12: Wire toasts into `MaintainersView` save and revoke

**Files:**
- Modify: `apps/admin/src/views/MaintainersView.tsx:49-64,149-158`
- Test: `apps/admin/src/views/MaintainersView.test.tsx` (new file)

**Interfaces:**
- Consumes: `useToast` (Task 2), `toast.maintainerSaved`/`toast.maintainerRevoked` (Task 3).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/views/MaintainersView.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '../i18n';
import { MaintainersView } from './MaintainersView';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { useToast } from '../store/toast';
import { ToastStack } from '../components/ToastStack';

interface Route {
  status: number;
  body: unknown;
}
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

const MAINTAINER_ROW = {
  userId: 'm1',
  role: 'moderator',
  extraPermissions: [],
  deniedPermissions: [],
  permissions: ['users.read'],
  grantedBy: 'admin1',
  grantedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  dangling: false,
  displayName: 'Mod One',
};

beforeEach(() => {
  vi.clearAllMocks();
  useToast.getState().reset();
  useUi.setState({ view: 'maintainers', param: null });
  useSession.setState({
    phase: 'ready',
    user: { id: 'admin1', displayName: 'Ops', isGuest: false },
    role: 'owner',
    permissions: new Set(['maintainers.read', 'maintainers.write']),
  });
});

describe('MaintainersView save/revoke toasts', () => {
  it('shows a success toast after saving a maintainer', async () => {
    stubFetch({
      '/dashboard/maintainers/m1': { status: 200, body: MAINTAINER_ROW },
      '/dashboard/maintainers': { status: 200, body: { maintainers: [MAINTAINER_ROW] } },
    });
    render(
      <>
        <MaintainersView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('編輯'));
    fireEvent.click(await screen.findByText('儲存'));
    expect(await screen.findByText('維護者權限已儲存')).toBeInTheDocument();
  });

  it('shows a success toast after revoking a maintainer', async () => {
    stubFetch({
      '/dashboard/maintainers/m1': { status: 204, body: {} },
      '/dashboard/maintainers': { status: 200, body: { maintainers: [MAINTAINER_ROW] } },
    });
    render(
      <>
        <MaintainersView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('撤銷'));
    // The trigger button and the confirm dialog's confirm button share the same label
    // ('撤銷'), so scope the second click to the dialog to avoid an ambiguous match.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '撤銷' }));
    expect(await screen.findByText('維護者權限已撤銷')).toBeInTheDocument();
  });

  it('shows an error toast when revoking fails (previously an unhandled rejection)', async () => {
    stubFetch({
      '/dashboard/maintainers/m1': { status: 500, body: { message: 'boom' } },
      '/dashboard/maintainers': { status: 200, body: { maintainers: [MAINTAINER_ROW] } },
    });
    render(
      <>
        <MaintainersView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('撤銷'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '撤銷' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test MaintainersView`
Expected: FAIL — `revoke` has no `catch`, and neither action shows a success toast yet

- [ ] **Step 3: Wire the toast into `Editor.save` and `MaintainersView.revoke`**

In `apps/admin/src/views/MaintainersView.tsx`, add the import:

```tsx
import { useToast } from '../store/toast';
```

Inside `Editor`, add the hook and update `save`. Replace:

```tsx
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.putMaintainer(row.userId, {
        role,
        ...(extra.size ? { extraPermissions: [...extra] } : {}),
        ...(denied.size ? { deniedPermissions: [...denied] } : {}),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      setBusy(false);
    }
  };
```

with:

```tsx
  const pushToast = useToast((s) => s.push);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.putMaintainer(row.userId, {
        role,
        ...(extra.size ? { extraPermissions: [...extra] } : {}),
        ...(denied.size ? { deniedPermissions: [...denied] } : {}),
      });
      pushToast('success', t('toast.maintainerSaved'));
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  };
```

(Place the `const pushToast = useToast((s) => s.push);` line among `Editor`'s other hook calls,
right after the existing `useState` declarations, before `toggle`.)

Inside `MaintainersView`, add the hook and update `revoke`. Replace:

```tsx
  const revoke = async (userId: string) => {
    setBusy(true);
    try {
      await api.deleteMaintainer(userId);
      await load();
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };
```

with:

```tsx
  const revoke = async (userId: string) => {
    setBusy(true);
    try {
      await api.deleteMaintainer(userId);
      await load();
      pushToast('success', t('toast.maintainerRevoked'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };
```

(Add `const pushToast = useToast((s) => s.push);` among `MaintainersView`'s other hook calls,
right after `const selfId = useSession((s) => s.user?.id);`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/admin test MaintainersView`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the entire admin and server suites one last time**

Run: `yarn workspace @trm/admin test && yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Run: `yarn workspace @trm/server test && yarn workspace @trm/server typecheck`
Expected: PASS for all four commands

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/views/MaintainersView.tsx apps/admin/src/views/MaintainersView.test.tsx
git commit -m "fix(admin): surface success/error toasts on maintainer save/revoke"
```
