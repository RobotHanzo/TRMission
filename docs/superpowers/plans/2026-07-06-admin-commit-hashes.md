# Admin Commit Hash Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the running server's commit hash and the currently-loaded web/admin bundle's commit hash in the admin panel's existing "versions" tile, with a warning when they diverge.

**Architecture:** CI passes the commit SHA as a Docker build-arg into both images; the server reads it from an env var at runtime (surfaced via the existing `/dashboard/overview` endpoint), while the web/admin bundle gets it baked in at build time via Vite's automatic `VITE_`-prefixed env var exposure (no `vite.config.ts` change needed). `OverviewView` renders both and a mismatch badge.

**Tech Stack:** GitHub Actions, Docker, NestJS, Vite (`import.meta.env`), React.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-05-admin-maps-replay-versions-design.md` (Feature 3), including the mid-brainstorm addendum: show a warning badge when the two hashes are present and differ.
- Local/dev builds never set `GIT_COMMIT` — both sides must fall back to a `'dev'` placeholder, and the mismatch warning must never fire when either side is `'dev'`.
- No new permission — this lives inside `OverviewView`, already gated by `overview.read`.
- `yarn workspace @trm/server test`, `yarn workspace @trm/admin test`, `yarn lint`, `yarn typecheck` must pass before every commit.
- **Shared files across sibling plans:** `apps/server/src/config/env.ts` and `apps/admin/src/net/rest.ts` are also touched by the replay-viewer plan (and `apps/admin/src/i18n/index.ts` by both sibling plans). Fine to run sequentially in one working tree; if run in parallel isolated worktrees, expect a merge/rebase step on these files afterward.

---

### Task 1: Server — `commitHash` in `/dashboard/overview` and `/version`

**Files:**

- Modify: `apps/server/src/config/env.ts`
- Modify: `apps/server/src/dashboard/dashboard.service.ts`
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts`
- Modify: `apps/server/src/health/health.controller.ts`
- Modify: `apps/server/test/dashboard-read.e2e.spec.ts`

**Interfaces:**

- Produces: `env.gitCommit: string`; `GET /dashboard/overview`'s `versions.commitHash`; `GET /version`'s `commitHash`.

- [ ] **Step 1: Write the failing test**

In `apps/server/test/dashboard-read.e2e.spec.ts`, extend the existing `overview` describe block's first test:

```ts
expect(typeof res.body.versions.engineVersion).toBe('number');
expect(typeof res.body.versions.uptimeSeconds).toBe('number');
expect(res.body.versions.commitHash).toBe('dev'); // no GIT_COMMIT set in tests
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-read`
Expected: FAIL — `res.body.versions.commitHash` is `undefined`, not `'dev'`.

- [ ] **Step 3: Add the env var**

In `apps/server/src/config/env.ts`, add near the top (after `mongoDb` or similar general entries):

```ts
  /** Git commit SHA baked into the running build (CI build-arg → Docker ENV). 'dev' locally. */
  gitCommit: process.env.GIT_COMMIT ?? 'dev',
```

- [ ] **Step 4: Add it to `DashboardService.overview()`**

In `apps/server/src/dashboard/dashboard.service.ts`, add the import and field:

```ts
import { env } from '../config/env';
```

```ts
      versions: {
        engineVersion: ENGINE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        contentHash: OFFICIAL_MAPS[0]?.hash ?? '',
        uptimeSeconds: Math.round(process.uptime()),
        commitHash: env.gitCommit,
      },
```

- [ ] **Step 5: Update the schema**

In `apps/server/src/dashboard/dashboard.schemas.ts`, add the field to `OverviewSchema.versions`:

```ts
  versions: z.object({
    engineVersion: z.number(),
    protocolVersion: z.number(),
    contentHash: z.string(),
    uptimeSeconds: z.number(),
    commitHash: z.string(),
  }),
```

- [ ] **Step 6: Add it to `/version` for consistency**

In `apps/server/src/health/health.controller.ts`:

```ts
import { env } from '../config/env';
```

```ts
  @Get('version')
  @ApiOperation({ summary: 'Engine / protocol / content / commit versions' })
  version(): { engineVersion: number; protocolVersion: number; contentHash: string; commitHash: string } {
    return {
      engineVersion: ENGINE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      contentHash: OFFICIAL_MAPS[0]?.hash ?? '',
      commitHash: env.gitCommit,
    };
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-read`
Expected: PASS.

- [ ] **Step 8: Typecheck + lint**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/server lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/config/env.ts apps/server/src/dashboard/dashboard.service.ts apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/health/health.controller.ts apps/server/test/dashboard-read.e2e.spec.ts
git commit -m "feat(server): expose GIT_COMMIT as commitHash in overview/version"
```

---

### Task 2: CI + Docker build-arg plumbing

**Files:**

- Modify: `.github/workflows/docker-build.yml`
- Modify: `apps/server/Dockerfile`
- Modify: `apps/web/Dockerfile`

**Interfaces:**

- Produces: both images built in CI carry `GIT_COMMIT` (server: `ENV GIT_COMMIT` read by `env.gitCommit`; web: `ENV VITE_COMMIT_HASH` consumed by Vite's automatic env exposure in Task 3).

This task has no automated test — Dockerfiles/CI aren't exercised by the Vitest suites in this repo. Each step includes an explicit manual-verification check instead of a unit test; that verification is the deliverable this task is reviewed against.

- [ ] **Step 1: Pass the build-arg from CI**

In `.github/workflows/docker-build.yml`, add `build-args` to the existing `docker/build-push-action@v6` step:

```yaml
- name: Build and push
  uses: docker/build-push-action@v6
  with:
    context: .
    file: ${{ matrix.dockerfile }}
    platforms: linux/amd64
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    labels: ${{ steps.meta.outputs.labels }}
    build-args: |
      GIT_COMMIT=${{ github.sha }}
    cache-from: type=gha,scope=${{ matrix.image }}
    cache-to: type=gha,mode=max,scope=${{ matrix.image }}
```

- [ ] **Step 2: Accept the build-arg in the server Dockerfile's final stage**

In `apps/server/Dockerfile`, add after `FROM node:24-slim AS run` (ARGs don't cross `FROM` boundaries, so it must be redeclared here, not just in the `deps` stage):

```dockerfile
FROM node:24-slim AS run
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
WORKDIR /app
```

(Insert the two new lines directly after this `FROM` line, before the existing `RUN corepack enable`.)

- [ ] **Step 3: Accept the build-arg and expose it to Vite in the web Dockerfile**

In `apps/web/Dockerfile`, add after `FROM node:24-slim AS build`, before the two `yarn workspace ... build` lines:

```dockerfile
FROM node:24-slim AS build
ARG GIT_COMMIT=dev
ENV VITE_COMMIT_HASH=$GIT_COMMIT
WORKDIR /app
RUN corepack enable
COPY . .
RUN yarn install --immutable
RUN yarn workspace @trm/proto generate
RUN yarn workspace @trm/web build
RUN yarn workspace @trm/admin build
```

(Only the `ARG`/`ENV` lines are new — everything else in this stage is unchanged; `VITE_COMMIT_HASH` being set as a process env var before both `vite build` invocations is what makes `import.meta.env.VITE_COMMIT_HASH` resolve to it in Task 3, with no `vite.config.ts` changes on either `apps/web` or `apps/admin`.)

- [ ] **Step 4: Manual verification (if Docker is available locally)**

Run:

```bash
docker build -f apps/server/Dockerfile --build-arg GIT_COMMIT=abc1234 -t trm-server-test .
docker run --rm trm-server-test node -e "console.log(process.env.GIT_COMMIT)"
```

Expected output: `abc1234`.

```bash
docker build -f apps/web/Dockerfile --build-arg GIT_COMMIT=abc1234 -t trm-web-test .
```

Expected: build succeeds (no error from the new `ARG`/`ENV` lines); this doesn't yet prove the value reached the bundle — that's confirmed visually once Task 3's UI change is deployed and the versions tile shows `abc1234` instead of `dev`.

If Docker isn't available in this environment, skip this step and note it in the task's completion summary — the CI workflow run on the next push to `main` is the real verification, since this repo's CI pipeline doesn't include a local Docker smoke test today.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-build.yml apps/server/Dockerfile apps/web/Dockerfile
git commit -m "build: pass GIT_COMMIT into both Docker images"
```

---

### Task 3: Admin UI — display both hashes + mismatch warning

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/views/OverviewView.tsx`
- Create: `apps/admin/src/views/OverviewView.test.tsx`
- Modify: `apps/admin/src/i18n/index.ts`

**Interfaces:**

- Consumes: `Overview.versions.commitHash` (Task 1); `import.meta.env.VITE_COMMIT_HASH` (Task 2, already typed via `apps/admin/tsconfig.json`'s `"types": ["vite/client"]` — no new `.d.ts` file needed).

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/views/OverviewView.test.tsx`, following the same `stubFetch` + real-translated-text convention `GamesView.test.tsx` uses (this repo's admin tests never mock `../net/rest` directly, and never assert raw i18n keys):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '../i18n';

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

import { OverviewView } from './OverviewView';

const baseOverview = {
  liveGames: { db: 0, inMemory: 0 },
  rooms: { lobby: 0, started: 0 },
  users: { total: 0, guests: 0, registered: 0, disabled: 0, new24h: 0 },
  sessions: { active: 0 },
  metrics: {
    activeConnections: 0,
    commandsTotal: 0,
    rejectionsTotal: 0,
    rejectionsByCode: {},
    leaksBlocked: 0,
    residentMemoryBytes: 0,
    commandApplyAvgMs: null,
  },
  versions: {
    engineVersion: 7,
    protocolVersion: 5,
    contentHash: 'abc',
    uptimeSeconds: 60,
    commitHash: 'sha-server',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_COMMIT_HASH', 'sha-web');
});

describe('OverviewView versions tile', () => {
  it('renders both commit hashes', async () => {
    stubFetch({ '/dashboard/overview': { status: 200, body: baseOverview } });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getByText('sha-server')).toBeInTheDocument());
    expect(screen.getByText('sha-web')).toBeInTheDocument();
  });

  it('shows a mismatch warning when the two hashes differ', async () => {
    stubFetch({ '/dashboard/overview': { status: 200, body: baseOverview } });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getByText('sha-server')).toBeInTheDocument());
    expect(screen.getByText('伺服器與前端版本不一致')).toBeInTheDocument();
  });

  it('shows no mismatch warning when they match', async () => {
    vi.stubEnv('VITE_COMMIT_HASH', 'sha-server');
    stubFetch({ '/dashboard/overview': { status: 200, body: baseOverview } });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getByText('sha-server')).toBeInTheDocument());
    expect(screen.queryByText('伺服器與前端版本不一致')).not.toBeInTheDocument();
  });

  it('shows no mismatch warning when either side is the dev placeholder', async () => {
    vi.stubEnv('VITE_COMMIT_HASH', 'dev');
    stubFetch({
      '/dashboard/overview': {
        status: 200,
        body: { ...baseOverview, versions: { ...baseOverview.versions, commitHash: 'dev' } },
      },
    });
    render(<OverviewView />);
    await waitFor(() => expect(screen.getAllByText('dev').length).toBeGreaterThan(0));
    expect(screen.queryByText('伺服器與前端版本不一致')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test OverviewView`
Expected: FAIL — `versions.commitHash` isn't rendered yet, and the `Overview` type doesn't have that field.

- [ ] **Step 3: Add the type field**

In `apps/admin/src/net/rest.ts`, extend the `Overview` interface:

```ts
versions: {
  engineVersion: number;
  protocolVersion: number;
  contentHash: string;
  uptimeSeconds: number;
  commitHash: string;
}
```

- [ ] **Step 4: Add i18n keys**

In `apps/admin/src/i18n/index.ts`, add to the `overview` namespace in both locale tables:

zh-Hant: `serverCommit: '伺服器版本'`, `webCommit: '前端版本'`, `versionMismatch: '伺服器與前端版本不一致'`
en: `serverCommit: 'Server build'`, `webCommit: 'Web build'`, `versionMismatch: 'Server and web builds differ'`

- [ ] **Step 5: Render both hashes + the mismatch badge**

In `apps/admin/src/views/OverviewView.tsx`, add the import and edit the versions tile:

```tsx
import { SignalBadge } from '../components/SignalBadge';
```

(`SignalBadge` is already imported at the top of this file for the page-title leak-guard badge — don't duplicate the import if it's already there.)

```tsx
<div className="oc-panel oc-tile">
  <h3>{t('overview.versionsTitle')}</h3>
  <div className="oc-kv">
    <span className="k">{t('overview.engine')}</span>
    <span className="v">v{data.versions.engineVersion}</span>
  </div>
  <div className="oc-kv">
    <span className="k">{t('overview.protocol')}</span>
    <span className="v">v{data.versions.protocolVersion}</span>
  </div>
  <div className="oc-kv">
    <span className="k">{t('overview.content')}</span>
    <span className="v" title={data.versions.contentHash}>
      {data.versions.contentHash.slice(0, 12)}…
    </span>
  </div>
  <div className="oc-kv">
    <span className="k">{t('overview.serverCommit')}</span>
    <span className="v" title={data.versions.commitHash}>
      {data.versions.commitHash}
    </span>
  </div>
  <div className="oc-kv">
    <span className="k">{t('overview.webCommit')}</span>
    <span className="v" title={webCommitHash}>
      {webCommitHash}
    </span>
  </div>
  {mismatch && (
    <div className="oc-kv">
      <SignalBadge aspect="caution" label={t('overview.versionMismatch')} />
    </div>
  )}
  <div className="oc-kv">
    <span className="k">{t('overview.uptime')}</span>
    <span className="v">{fmtUptime(data.versions.uptimeSeconds)}</span>
  </div>
</div>
```

Add the two derived values inside the `OverviewView` component, before the `return`:

```tsx
const webCommitHash = (import.meta.env.VITE_COMMIT_HASH as string | undefined) ?? 'dev';
const mismatch =
  !!data &&
  data.versions.commitHash !== 'dev' &&
  webCommitHash !== 'dev' &&
  data.versions.commitHash !== webCommitHash;
```

(`data` is already declared earlier in the component via `useState`/the polling effect — this reads the same variable, and since the whole component already early-returns while `!data`, placing this after that guard, right before the `return (...)` JSX, is fine.)

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/admin test OverviewView`
Expected: PASS.

- [ ] **Step 7: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: PASS.

- [ ] **Step 8: Full verification sweep**

Run: `yarn typecheck && yarn lint && yarn workspace @trm/server test --run dashboard-read && yarn workspace @trm/admin test`
Expected: PASS across the board.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/views/OverviewView.tsx apps/admin/src/views/OverviewView.test.tsx apps/admin/src/i18n/index.ts
git commit -m "feat(admin): show server/web commit hashes and a mismatch warning"
```

---

## Self-Review Notes

- **Spec coverage:** `GIT_COMMIT` build-arg plumbing (Task 2), server-side exposure via `/dashboard/overview` and `/version` (Task 1), web-side exposure via Vite's automatic `VITE_`-prefixed env var (Task 2/3), display + mismatch warning that's silent when either side is the `'dev'` placeholder (Task 3, per the brainstorm addendum) — all covered.
- **Placeholder scan:** none, except Task 2's Step 4, which is explicitly a manual/optional verification (documented as such, not a stand-in for an automated test that should exist).
- **Type consistency:** `env.gitCommit` (Task 1, server) → `versions.commitHash` (schema + service, Task 1) → `Overview.versions.commitHash` (Task 3, admin client) — same field name end-to-end.
