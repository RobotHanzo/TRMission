# Admin rooms detail + auto-purge no-op audit skip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the background purge sweep from writing no-op audit entries, and give the admin Rooms view a click-to-open detail drawer at parity with the Games view.

**Architecture:** Two independent changes. (1) `PurgeService.runSweep` skips the `purge.run` audit write only for *auto* sweeps that deleted nothing; manual runs always log. (2) A new `GET /dashboard/rooms/:code` endpoint returns a redacted room detail (never the seed), and `RoomsView` rows become clickable, opening a `RoomDrawer` that fetches it — inline Close/Delete buttons stay, with click-through suppressed, and are mirrored inside the drawer.

**Tech Stack:** NestJS + zod (`nestjs-zod`) + native mongodb driver (server); React + Vite 5 + zustand + react-i18next (admin); vitest + supertest + mongodb-memory-server (server tests); vitest + @testing-library/react (admin tests). Yarn 4 workspaces.

## Global Constraints

- **Hidden info:** a room's `seed` (set once STARTED) encodes deck order = every hidden hand — the room detail MUST NOT include it, exactly like the game detail withholds a LIVE game's seed.
- **i18n:** `apps/admin/src/i18n/index.ts` keeps the **same key tree in both** `zhHant` and `en` — every new key goes in both objects.
- **CSS:** admin UI uses `oc-`-prefixed class names only; no CSS-in-JS.
- **Vite pinned `^5`** in `apps/admin` (vitest 2 compat) — do not bump.
- **Determinism/versions:** no changes to the engine, purge thresholds, or lobby mutation logic.
- **Commits:** stage only the files this work changed (`git add <paths>`); never `git add -A`/`.` — other agents may share this worktree.
- **Validate per workspace:** server `yarn workspace @trm/server test --run <substr>`, `yarn workspace @trm/server typecheck`; admin `yarn workspace @trm/admin test <substr>`, `yarn workspace @trm/admin typecheck`, `yarn workspace @trm/admin lint`.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `apps/server/src/dashboard/purge.service.ts` (modify) | Guard the auto-sweep audit write on non-zero deletions | 1 |
| `apps/server/test/purge-audit-skip.e2e.spec.ts` (create) | Prove auto no-op skips the log; manual no-op still logs | 1 |
| `apps/server/src/dashboard/dashboard.schemas.ts` (modify) | `DashboardRoomDetailSchema` | 2 |
| `apps/server/src/dashboard/dashboard-games.service.ts` (modify) | `roomDetail(code)` | 2 |
| `apps/server/src/dashboard/dashboard-games.controller.ts` (modify) | `GET rooms/:code` | 2 |
| `apps/server/test/dashboard-read.e2e.spec.ts` (modify) | Room-detail endpoint tests | 2 |
| `apps/admin/src/store/ui.ts` (modify) | Add `'rooms'` to the detail-drawer view union | 3 |
| `apps/admin/src/net/rest.ts` (modify) | `RoomDetail` type + `api.getRoom` | 3 |
| `apps/admin/src/store/ui.test.ts` (modify) | Cover `openDetail`/`closeDetail` for rooms | 3 |
| `apps/admin/src/i18n/index.ts` (modify) | `rooms.*` detail keys (both locales) | 4 |
| `apps/admin/src/views/RoomsView.tsx` (modify) | Clickable rows + `RoomDrawer` | 4 |
| `apps/admin/src/views/RoomsView.test.tsx` (modify) | Row-click opens the drawer | 4 |

---

## Task 1: Auto-purge no-op audit skip

**Files:**
- Modify: `apps/server/src/dashboard/purge.service.ts:250-254`
- Test: `apps/server/test/purge-audit-skip.e2e.spec.ts` (create)

**Interfaces:**
- Consumes: `PurgeService.runSweep(trigger: 'auto' | 'manual', actor?: AuthUser): Promise<PurgeSummary>` and the `dashboardAudit` collection (already exist).
- Produces: unchanged public signature; only the internal audit-write condition changes.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/purge-audit-skip.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, type TestApp } from './app';
import { PurgeService } from '../src/dashboard/purge.service';
import type { AuthUser } from '../src/auth/auth.types';

let t: TestApp;
const actor = { userId: 'op-1', displayName: 'Operator' } as AuthUser;
const countRuns = () =>
  t.db.collection('dashboardAudit').countDocuments({ action: 'purge.run' } as never);

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('purge no-op audit skip', () => {
  it('an auto sweep that deletes nothing writes no purge.run audit entry', async () => {
    const purge = t.app.get(PurgeService);
    const before = await countRuns();
    const summary = await purge.runSweep('auto');
    expect(summary.roomsDeleted).toBe(0);
    expect(summary.gamesDeleted).toBe(0);
    expect(await countRuns()).toBe(before);
  });

  it('a manual sweep that deletes nothing still writes one purge.run audit entry', async () => {
    const purge = t.app.get(PurgeService);
    const before = await countRuns();
    const summary = await purge.runSweep('manual', actor);
    expect(summary.roomsDeleted).toBe(0);
    expect(summary.gamesDeleted).toBe(0);
    expect(await countRuns()).toBe(before + 1);
  });

  it('an auto sweep that deletes a stale room still writes a purge.run audit entry', async () => {
    const stale = new Date(Date.now() - 72 * 3_600_000);
    await t.db.collection('rooms').insertOne({
      _id: 'STALE1',
      hostId: 'nobody',
      status: 'LOBBY',
      members: [],
      maxPlayers: 5,
      settings: {},
      createdAt: stale,
      updatedAt: stale,
    } as never);
    const purge = t.app.get(PurgeService);
    const before = await countRuns();
    const summary = await purge.runSweep('auto');
    expect(summary.roomsDeleted).toBe(1);
    expect(await countRuns()).toBe(before + 1);
  });
});
```

> Note: the test app's `purgeIntervalMs` defaults to 1 hour, so the background timer never fires during the run — the explicit `runSweep` calls are the only sweeps. `roomLobbyPurgeHours` defaults to 24, so a 72h-old LOBBY room is reliably stale.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run purge-audit-skip`
Expected: FAIL on the first case — current code logs every auto sweep, so `countRuns()` returns `before + 1`, not `before`.

- [ ] **Step 3: Implement the guard**

In `apps/server/src/dashboard/purge.service.ts`, replace the trailing audit block in `runSweep` (currently):

```ts
    if (trigger === 'auto') {
      await this.audit.logSystem('purge.run', undefined, params);
    } else {
      await this.audit.log(actor!, 'purge.run', undefined, params);
    }
```

with:

```ts
    if (trigger === 'auto') {
      // An idle auto sweep that changed nothing isn't worth an audit row (it would otherwise
      // stream 0/0 entries on every interval and fill the Purge view's recent-runs table).
      if (summary.roomsDeleted > 0 || summary.gamesDeleted > 0) {
        await this.audit.logSystem('purge.run', undefined, params);
      }
    } else {
      // A manual run always logs — it records that an operator triggered a sweep, even a no-op.
      await this.audit.log(actor!, 'purge.run', undefined, params);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run purge-audit-skip`
Expected: PASS (3 tests).

- [ ] **Step 5: Guard against regressions in the existing purge suite**

Run: `yarn workspace @trm/server test --run dashboard-purge`
Expected: PASS — its "exactly one `purge.run` audit entry" case deletes 2 rooms + 1 game, so it is unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/dashboard/purge.service.ts apps/server/test/purge-audit-skip.e2e.spec.ts
git commit -m "fix(dashboard): skip the audit log for no-op auto-purge sweeps"
```

---

## Task 2: Server room-detail endpoint

**Files:**
- Modify: `apps/server/src/dashboard/dashboard.schemas.ts` (after `RoomsListSchema`, ~line 219)
- Modify: `apps/server/src/dashboard/dashboard-games.service.ts` (import + new method)
- Modify: `apps/server/src/dashboard/dashboard-games.controller.ts` (import + new route)
- Test: `apps/server/test/dashboard-read.e2e.spec.ts` (the `describe('rooms', ...)` block, ~line 306)

**Interfaces:**
- Consumes: `RoomRepo.get(code)`, `DEFAULT_ROOM_SETTINGS`, `MapSelector` (from `../lobby/room.repo`); `this.games` collection (already in the service).
- Produces:
  - `DashboardGamesService.roomDetail(code: string): Promise<RoomDetail>` where `RoomDetail` is the object shape below.
  - `GET /api/v1/dashboard/rooms/:code` (`rooms.read`) returning that shape.
  - `DashboardRoomDetailSchema` (zod) — the exact field set the client `RoomDetail` type (Task 3) mirrors.

- [ ] **Step 1: Write the failing test**

In `apps/server/test/dashboard-read.e2e.spec.ts`, add two cases inside the existing `describe('rooms', () => { ... })` block (after the `lists rooms with status and members` test). `roomCode` is a STARTED room whose game is LIVE and whose doc carries a `seed`, so the seed-omission check is meaningful:

```ts
  it('room detail returns members, settings, and linked game status — never the seed', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/rooms/${roomCode}`)
      .set(auth(admin.token))
      .expect(200);
    expect(res.body.code).toBe(roomCode);
    expect(res.body.status).toBe('STARTED');
    expect(res.body.gameId).toBe(liveGameId);
    expect(res.body.gameStatus).toBe('LIVE');
    expect(res.body.members).toHaveLength(2);
    expect(res.body.settings.map.source).toBe('official');
    expect(typeof res.body.settings.unlimitedStationBorrow).toBe('boolean');
    expect(res.body).not.toHaveProperty('seed');
  });

  it('404s an unknown room code', async () => {
    await request(server())
      .get('/api/v1/dashboard/rooms/NOPE1')
      .set(auth(admin.token))
      .expect(404);
  });
```

> Scope note: a dedicated "403 without `rooms.read`" case is omitted — the `viewer` role already holds `rooms.read`, and the `@RequirePermission('rooms.read')` guard is the same infrastructure already covered for the sibling list endpoint. Adding one would require a bespoke `deniedPermissions` account for no new coverage.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-read`
Expected: FAIL — the `room detail ...` case gets 404 (no `GET rooms/:code` route yet), so `.expect(200)` fails. (The `404s an unknown` case may already pass since an unmatched GET 404s — that's fine; the first case drives the red.)

- [ ] **Step 3: Add the zod schema**

In `apps/server/src/dashboard/dashboard.schemas.ts`, immediately after `RoomsListSchema` (the `z.object({ rooms: ..., nextCursor: ... })` at ~line 216-219), add:

```ts
export const DashboardRoomDetailSchema = z.object({
  code: z.string(),
  hostId: z.string(),
  hostName: z.string().optional(),
  status: z.string(),
  visibility: z.string(),
  maxPlayers: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  gameId: z.string().optional(),
  gameStatus: z.string().optional(),
  members: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      seat: z.number(),
      isBot: z.boolean(),
      isGuest: z.boolean(),
      ready: z.boolean(),
      difficulty: z.string().optional(),
    }),
  ),
  spectators: z.array(z.object({ userId: z.string(), displayName: z.string() })),
  settings: z.object({
    map: z.object({ source: z.enum(['official', 'custom']), id: z.string() }),
    allowSpectating: z.boolean(),
    eventsMode: z.string(),
    unlimitedStationBorrow: z.boolean(),
    secondDrawAfterBlindRainbow: z.boolean(),
    noUnfinishedTicketPenalty: z.boolean(),
    doubleRouteSingleFor23: z.boolean(),
  }),
});
```

- [ ] **Step 4: Add the service method**

In `apps/server/src/dashboard/dashboard-games.service.ts`, extend the room-repo import (currently `import { RoomRepo, type RoomDoc } from '../lobby/room.repo';`) to also bring in the defaults:

```ts
import { RoomRepo, DEFAULT_ROOM_SETTINGS, type RoomDoc } from '../lobby/room.repo';
```

Then add this method (place it next to `listRooms`, at the end of the class):

```ts
  async roomDetail(code: string) {
    const room = await this.rooms.get(code);
    if (!room) throw new NotFoundException('room not found');

    const gameDoc = room.gameId
      ? await this.games.findOne({ _id: room.gameId }, { projection: { status: 1 } })
      : null;
    // Merge over defaults so a room written before a settings field existed still projects fully.
    const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
    const hostName = room.members.find((m) => m.userId === room.hostId)?.displayName;

    return {
      code: room._id,
      hostId: room.hostId,
      ...(hostName ? { hostName } : {}),
      status: room.status,
      visibility: settings.visibility,
      maxPlayers: room.maxPlayers,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      ...(room.gameId ? { gameId: room.gameId } : {}),
      ...(gameDoc?.status ? { gameStatus: gameDoc.status } : {}),
      // NOTE: room.seed is deliberately never projected — it encodes deck order (hidden hands).
      members: room.members.map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        seat: m.seat,
        isBot: m.isBot === true,
        isGuest: m.isGuest === true,
        ready: m.ready === true,
        ...(m.difficulty ? { difficulty: m.difficulty } : {}),
      })),
      spectators: (room.spectators ?? []).map((s) => ({
        userId: s.userId,
        displayName: s.displayName,
      })),
      settings: {
        map:
          settings.map.source === 'custom'
            ? { source: 'custom' as const, id: settings.map.customMapId }
            : { source: 'official' as const, id: settings.map.mapId },
        allowSpectating: settings.allowSpectating,
        eventsMode: settings.eventsMode,
        unlimitedStationBorrow: settings.unlimitedStationBorrow,
        secondDrawAfterBlindRainbow: settings.secondDrawAfterBlindRainbow,
        noUnfinishedTicketPenalty: settings.noUnfinishedTicketPenalty,
        doubleRouteSingleFor23: settings.doubleRouteSingleFor23,
      },
    };
  }
```

- [ ] **Step 5: Add the controller route**

In `apps/server/src/dashboard/dashboard-games.controller.ts`, add `DashboardRoomDetailSchema` to the import block from `./dashboard.schemas` (alongside `DashboardRoomRowSchema`), then add this handler immediately after the existing `listRooms` method (before `@Post('rooms/:code/close')`):

```ts
  @Get('rooms/:code')
  @RequirePermission('rooms.read')
  @ApiOperation({
    summary: 'One room: members, settings, and linked game status. Never exposes the seed.',
  })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardRoomDetailSchema) })
  roomDetail(@Param('code') code: string) {
    return this.games.roomDetail(code);
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-read`
Expected: PASS (rooms detail + 404 + the pre-existing list test).

- [ ] **Step 7: Typecheck**

Run: `yarn workspace @trm/server typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/dashboard/dashboard.schemas.ts apps/server/src/dashboard/dashboard-games.service.ts apps/server/src/dashboard/dashboard-games.controller.ts apps/server/test/dashboard-read.e2e.spec.ts
git commit -m "feat(dashboard): add GET /dashboard/rooms/:code room detail (seed-redacted)"
```

---

## Task 3: Admin router union + REST client type

**Files:**
- Modify: `apps/admin/src/store/ui.ts:77` and `:100`
- Modify: `apps/admin/src/net/rest.ts` (after the `RoomRow` interface, ~line 123; and in the `api` object after `deleteRoom`, ~line 315)
- Test: `apps/admin/src/store/ui.test.ts`

**Interfaces:**
- Consumes: `DashboardRoomDetailSchema`'s shape from Task 2.
- Produces:
  - `RoomDetail` TS interface (imported by Task 4).
  - `api.getRoom(code: string): Promise<RoomDetail>`.
  - `useUi().openDetail('rooms', code)` / `closeDetail()` clearing the param on the rooms view.

- [ ] **Step 1: Write the failing test**

In `apps/admin/src/store/ui.test.ts`, first ensure `useUi` is imported (add `import { useUi } from './ui';` to the existing imports if absent — the file currently imports `parsePath`/`pathFor` from `./ui`, so extend that import: `import { parsePath, pathFor, useUi } from './ui';`). Then add:

```ts
it('opens and closes the rooms detail drawer param', () => {
  useUi.getState().openDetail('rooms', 'ABCD');
  expect(useUi.getState().view).toBe('rooms');
  expect(useUi.getState().param).toBe('ABCD');
  useUi.getState().closeDetail();
  expect(useUi.getState().param).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test ui.test`
Expected: FAIL — `closeDetail()` currently only clears the param for `users`/`games`/`maps`, so on the `rooms` view `param` stays `'ABCD'`. (It may also fail to typecheck `openDetail('rooms', ...)`; that is resolved in Step 3.)

- [ ] **Step 3: Widen the view union in the store**

In `apps/admin/src/store/ui.ts`, update the `openDetail` signature (line 77) from:

```ts
  openDetail(view: 'users' | 'games' | 'maps', id: string): void;
```

to:

```ts
  openDetail(view: 'users' | 'games' | 'maps' | 'rooms', id: string): void;
```

and the `closeDetail` guard (line 100) from:

```ts
    if (view === 'users' || view === 'games' || view === 'maps') {
```

to:

```ts
    if (view === 'users' || view === 'games' || view === 'maps' || view === 'rooms') {
```

Also update the doc comment on `param` (line 71) to read `/** Detail id for users/games/rooms/maps (a drawer over the list). */` for accuracy.

- [ ] **Step 4: Add the REST type + method**

In `apps/admin/src/net/rest.ts`, add the `RoomDetail` interface directly after the `RoomRow` interface (~line 123):

```ts
export interface RoomDetail {
  code: string;
  hostId: string;
  hostName?: string;
  status: string;
  visibility: string;
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
  gameId?: string;
  gameStatus?: string;
  members: {
    userId: string;
    displayName: string;
    seat: number;
    isBot: boolean;
    isGuest: boolean;
    ready: boolean;
    difficulty?: string;
  }[];
  spectators: { userId: string; displayName: string }[];
  settings: {
    map: { source: 'official' | 'custom'; id: string };
    allowSpectating: boolean;
    eventsMode: string;
    unlimitedStationBorrow: boolean;
    secondDrawAfterBlindRainbow: boolean;
    noUnfinishedTicketPenalty: boolean;
    doubleRouteSingleFor23: boolean;
  };
}
```

Then, in the `api` object, add `getRoom` immediately after the `deleteRoom` entry (~line 315):

```ts
  getRoom: (code: string) => req<RoomDetail>('GET', `/dashboard/rooms/${encodeURIComponent(code)}`),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/admin test ui.test`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `yarn workspace @trm/admin typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/store/ui.ts apps/admin/src/net/rest.ts apps/admin/src/store/ui.test.ts
git commit -m "feat(admin): wire rooms into the detail-drawer router + REST client"
```

---

## Task 4: RoomsView clickable rows + RoomDrawer

**Files:**
- Modify: `apps/admin/src/i18n/index.ts` (the `rooms:` block in **both** `zhHant` ~line 184 and `en` ~line 521)
- Modify: `apps/admin/src/views/RoomsView.tsx` (full rewrite below)
- Test: `apps/admin/src/views/RoomsView.test.tsx`

**Interfaces:**
- Consumes: `api.getRoom` + `RoomDetail` (Task 3); `useUi().openDetail/closeDetail/param` with `'rooms'` (Task 3); `Drawer`, `SignalBadge`/`aspectForStatus`, `fmtDateTime`/`shortId`.
- Produces: no exported API changes; a `RoomDrawer` component local to `RoomsView.tsx`.

- [ ] **Step 1: Add i18n keys (both locales)**

In `apps/admin/src/i18n/index.ts`, add these keys inside the `zhHant` `rooms:` object (after `deleteConfirmBodyStarted`):

```ts
    detailTitle: '房間詳情',
    host: '房主',
    members: '成員',
    ready: '就緒',
    notReady: '未就緒',
    bot: '電腦',
    guest: '訪客',
    spectators: '觀戰者',
    linkedGame: '關聯對局',
    gameStatus: '對局狀態',
    settings: '房間設定',
    map: '地圖',
    mapOfficial: '官方',
    mapCustom: '自訂',
    allowSpectating: '允許觀戰',
    eventsMode: '隨機事件',
    created: '建立時間',
    updated: '最後活動',
    flagUnlimitedStationBorrow: '無限車站借用',
    flagSecondDrawAfterBlindRainbow: '盲抽彩虹後可再抽一張',
    flagNoUnfinishedTicketPenalty: '未完成車票不扣分',
    flagDoubleRouteSingleFor23: '2–3 人可用雙線路',
    on: '開',
    off: '關',
```

and the matching keys inside the `en` `rooms:` object (after its `deleteConfirmBodyStarted`):

```ts
    detailTitle: 'Room detail',
    host: 'Host',
    members: 'Members',
    ready: 'ready',
    notReady: 'not ready',
    bot: 'bot',
    guest: 'guest',
    spectators: 'Spectators',
    linkedGame: 'Linked game',
    gameStatus: 'Game status',
    settings: 'Settings',
    map: 'Map',
    mapOfficial: 'official',
    mapCustom: 'custom',
    allowSpectating: 'Allow spectating',
    eventsMode: 'Random events',
    created: 'Created',
    updated: 'Last activity',
    flagUnlimitedStationBorrow: 'Unlimited station borrow',
    flagSecondDrawAfterBlindRainbow: 'Second draw after blind rainbow',
    flagNoUnfinishedTicketPenalty: 'No unfinished-ticket penalty',
    flagDoubleRouteSingleFor23: 'Double routes at 2–3 players',
    on: 'On',
    off: 'Off',
```

- [ ] **Step 2: Write the failing test**

In `apps/admin/src/views/RoomsView.test.tsx`, add a new `describe` block (after the existing ones). It stubs both the list and the detail route (`stubFetch` matches by `url.includes`; the detail URL `/dashboard/rooms/ABCD` and the list URL `/dashboard/rooms?status=all` do not collide):

```ts
describe('RoomsView detail drawer', () => {
  it('opens the detail drawer when a room row is clicked', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD': {
        status: 200,
        body: {
          code: 'ABCD',
          hostId: 'h1',
          hostName: 'Hostie',
          status: 'LOBBY',
          visibility: 'PUBLIC',
          maxPlayers: 5,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          members: [
            { userId: 'h1', displayName: 'Hostie', seat: 0, isBot: false, isGuest: false, ready: true },
          ],
          spectators: [],
          settings: {
            map: { source: 'official', id: 'taiwan' },
            allowSpectating: true,
            eventsMode: 'off',
            unlimitedStationBorrow: true,
            secondDrawAfterBlindRainbow: false,
            noUnfinishedTicketPenalty: false,
            doubleRouteSingleFor23: true,
          },
        },
      },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(<RoomsView />);
    fireEvent.click(await screen.findByText('ABCD'));
    expect(await screen.findByText('Hostie')).toBeInTheDocument();
    expect(await screen.findByText('房間詳情 · ABCD')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn workspace @trm/admin test RoomsView`
Expected: FAIL — rows are not clickable yet and there is no drawer, so `Hostie` never renders.

- [ ] **Step 4: Rewrite `RoomsView.tsx`**

Replace the entire contents of `apps/admin/src/views/RoomsView.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { DoorClosed, Info, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type RoomDetail, type RoomRow } from '../net/rest';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import { SignalBadge, aspectForStatus } from '../components/SignalBadge';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../store/toast';
import { fmtDateTime, shortId } from '../lib/fmt';

const TABS = ['LOBBY', 'STARTED', 'CLOSED', 'all'] as const;
const TAB_KEY: Record<(typeof TABS)[number], string> = {
  LOBBY: 'rooms.tabLobby',
  STARTED: 'rooms.tabStarted',
  CLOSED: 'rooms.tabClosed',
  all: 'rooms.tabAll',
};

const statusKey = (s: string): string =>
  s === 'LOBBY'
    ? 'rooms.statusLobby'
    : s === 'STARTED'
      ? 'rooms.statusStarted'
      : 'rooms.statusClosed';

function RoomDrawer({
  row,
  onClose,
  onRequestClose,
  onRequestDelete,
}: {
  row: RoomRow;
  onClose: () => void;
  onRequestClose: (code: string) => void;
  onRequestDelete: (code: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
  const [detail, setDetail] = useState<RoomDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getRoom(row.code)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => onClose());
    return () => {
      cancelled = true;
    };
  }, [row.code, onClose]);

  const flag = (on: boolean): string => (on ? t('rooms.on') : t('rooms.off'));

  return (
    <Drawer title={`${t('rooms.detailTitle')} · ${row.code}`} onClose={onClose}>
      {!detail ? (
        <div className="oc-empty">{t('common.loading')}</div>
      ) : (
        <>
          <section>
            <div className="oc-kv">
              <span className="k">{t('rooms.colStatus')}</span>
              <span className="v">
                <SignalBadge
                  aspect={aspectForStatus(row.status)}
                  label={t(statusKey(row.status))}
                />
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.host')}</span>
              <span className="v">{detail.hostName ?? shortId(detail.hostId)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.colVisibility')}</span>
              <span className="v">
                {detail.visibility === 'PUBLIC' ? t('rooms.visPublic') : t('rooms.visInvite')}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.colMembers')}</span>
              <span className="v">
                {row.memberCount}/{detail.maxPlayers}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.created')}</span>
              <span className="v">{fmtDateTime(detail.createdAt, locale)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.updated')}</span>
              <span className="v">{fmtDateTime(detail.updatedAt, locale)}</span>
            </div>
          </section>

          {detail.gameId && (
            <section>
              <h3>{t('rooms.linkedGame')}</h3>
              <div className="oc-kv">
                <span className="k">ID</span>
                <span className="v oc-mono" title={detail.gameId}>
                  {shortId(detail.gameId)}
                </span>
              </div>
              {detail.gameStatus && (
                <div className="oc-kv">
                  <span className="k">{t('rooms.gameStatus')}</span>
                  <span className="v">{detail.gameStatus}</span>
                </div>
              )}
            </section>
          )}

          <section>
            <h3>{t('rooms.members')}</h3>
            {detail.members.map((m) => (
              <div className="oc-kv" key={m.userId}>
                <span className="k">
                  P{m.seat + 1} {m.displayName}
                </span>
                <span className="v">
                  {m.isBot
                    ? `${t('rooms.bot')}${m.difficulty ? ` · ${m.difficulty}` : ''}`
                    : m.isGuest
                      ? t('rooms.guest')
                      : ''}{' '}
                  <span className="oc-muted">{m.ready ? t('rooms.ready') : t('rooms.notReady')}</span>
                </span>
              </div>
            ))}
            {detail.spectators.length > 0 && (
              <div className="oc-kv">
                <span className="k">{t('rooms.spectators')}</span>
                <span className="v">{detail.spectators.length}</span>
              </div>
            )}
          </section>

          <section>
            <h3>{t('rooms.settings')}</h3>
            <div className="oc-kv">
              <span className="k">{t('rooms.map')}</span>
              <span className="v">
                {detail.settings.map.source === 'custom'
                  ? `${t('rooms.mapCustom')} · ${shortId(detail.settings.map.id)}`
                  : `${t('rooms.mapOfficial')} · ${detail.settings.map.id}`}
              </span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.allowSpectating')}</span>
              <span className="v">{flag(detail.settings.allowSpectating)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.eventsMode')}</span>
              <span className="v">{detail.settings.eventsMode}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagUnlimitedStationBorrow')}</span>
              <span className="v">{flag(detail.settings.unlimitedStationBorrow)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagSecondDrawAfterBlindRainbow')}</span>
              <span className="v">{flag(detail.settings.secondDrawAfterBlindRainbow)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagNoUnfinishedTicketPenalty')}</span>
              <span className="v">{flag(detail.settings.noUnfinishedTicketPenalty)}</span>
            </div>
            <div className="oc-kv">
              <span className="k">{t('rooms.flagDoubleRouteSingleFor23')}</span>
              <span className="v">{flag(detail.settings.doubleRouteSingleFor23)}</span>
            </div>
          </section>

          {canClose && row.status === 'LOBBY' && (
            <section>
              <button className="oc-btn danger" onClick={() => onRequestClose(row.code)}>
                <DoorClosed size={14} aria-hidden />
                {t('rooms.close')}
              </button>
            </section>
          )}
          {canDelete && (
            <section>
              <button className="oc-btn danger" onClick={() => onRequestDelete(row.code)}>
                <Trash2 size={14} aria-hidden />
                {t('rooms.delete')}
              </button>
            </section>
          )}
        </>
      )}
    </Drawer>
  );
}

export function RoomsView() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const param = useUi((s) => s.param);
  const openDetail = useUi((s) => s.openDetail);
  const closeDetail = useUi((s) => s.closeDetail);
  const canClose = useSession((s) => s.hasPermission('rooms.close'));
  const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
  const pushToast = useToast((s) => s.push);

  const [rows, setRows] = useState<RoomRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (append: string | null) => {
      setLoading(true);
      try {
        const page = await api.listRooms({ status: tab, ...(append ? { cursor: append } : {}) });
        setRows((prev) => (append ? [...prev, ...page.rooms] : page.rooms));
        setCursor(page.nextCursor);
      } finally {
        setLoading(false);
      }
    },
    [tab],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

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

  const del = async (code: string, reason?: string) => {
    setBusy(true);
    try {
      await api.deleteRoom(code, reason);
      setRows((prev) => prev.filter((r) => r.code !== code));
      if (param === code) closeDetail();
      pushToast('success', t('toast.roomDeleted'));
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  const openRow = param ? rows.find((r) => r.code === param) : undefined;

  return (
    <div>
      <h1 className="oc-page-title">
        {t('rooms.title')}
        {canClose && (
          <span className="oc-info-hint" title={t('rooms.startedHint')}>
            <Info size={14} aria-hidden />
          </span>
        )}
      </h1>
      <div className="oc-toolbar">
        <div className="oc-tabs" role="tablist">
          {TABS.map((s) => (
            <button
              key={s}
              className={tab === s ? 'active' : ''}
              onClick={() => setTab(s)}
              role="tab"
              aria-selected={tab === s}
            >
              {t(TAB_KEY[s])}
            </button>
          ))}
        </div>
      </div>

      <div className="oc-table-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              <th>{t('rooms.colRoom')}</th>
              <th>{t('rooms.colStatus')}</th>
              <th className="num">{t('rooms.colMembers')}</th>
              <th>{t('rooms.colVisibility')}</th>
              <th className="num">{t('rooms.colUpdated')}</th>
              {(canClose || canDelete) && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="clickable" onClick={() => openDetail('rooms', r.code)}>
                <td className="oc-mono">{r.code}</td>
                <td>
                  <SignalBadge aspect={aspectForStatus(r.status)} label={t(statusKey(r.status))} />
                </td>
                <td className="num">
                  {r.memberCount}/{r.maxPlayers}
                </td>
                <td>{r.visibility === 'PUBLIC' ? t('rooms.visPublic') : t('rooms.visInvite')}</td>
                <td className="num">{fmtDateTime(r.updatedAt, locale)}</td>
                {(canClose || canDelete) && (
                  <td>
                    {canClose && r.status === 'LOBBY' && (
                      <button
                        className="oc-btn danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setClosing(r.code);
                        }}
                      >
                        <DoorClosed size={14} aria-hidden />
                        {t('rooms.close')}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="oc-btn danger"
                        style={canClose && r.status === 'LOBBY' ? { marginLeft: 6 } : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(r.code);
                        }}
                      >
                        <Trash2 size={14} aria-hidden />
                        {t('rooms.delete')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
        )}
        {cursor && (
          <div className="oc-pager">
            <button className="oc-btn" disabled={loading} onClick={() => void load(cursor)}>
              {t('common.loadMore')}
            </button>
          </div>
        )}
      </div>

      {openRow && (
        <RoomDrawer
          row={openRow}
          onClose={closeDetail}
          onRequestClose={setClosing}
          onRequestDelete={setDeleting}
        />
      )}

      {closing && (
        <ConfirmDialog
          title={t('rooms.closeConfirmTitle')}
          body={t('rooms.closeConfirmBody')}
          confirmLabel={t('rooms.close')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void close(closing, reason)}
          onCancel={() => setClosing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('rooms.deleteConfirmTitle')}
          body={
            rows.find((r) => r.code === deleting)?.status === 'STARTED'
              ? t('rooms.deleteConfirmBodyStarted')
              : t('rooms.deleteConfirmBody')
          }
          confirmLabel={t('rooms.delete')}
          danger
          withReason
          busy={busy}
          onConfirm={(reason) => void del(deleting, reason)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
```

> Behaviour notes: the drawer reads mutable status (`row.status`, `row.memberCount`) from the live list row, so a close performed from the row or the drawer immediately hides the drawer's Close button; a delete of the open room removes the row and `del` calls `closeDetail()`. On a fresh deep-link to `/admin/rooms/ABCD` the drawer appears once the (default `all`) list load includes that row — consistent with the list-driven design.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `yarn workspace @trm/admin test RoomsView`
Expected: PASS — the new drawer test plus the existing close/delete toast tests (inline buttons still work; `stopPropagation` keeps them from opening the drawer).

- [ ] **Step 6: Typecheck + lint**

Run: `yarn workspace @trm/admin typecheck && yarn workspace @trm/admin lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/i18n/index.ts apps/admin/src/views/RoomsView.tsx apps/admin/src/views/RoomsView.test.tsx
git commit -m "feat(admin): open a room detail drawer on row click, at Games-view parity"
```

---

## Task 5: Full validation + graph refresh

**Files:** none (verification only)

- [ ] **Step 1: Run the affected workspace test suites**

Run: `yarn workspace @trm/server test --run dashboard && yarn workspace @trm/admin test`
Expected: PASS across dashboard e2e specs and all admin view/store tests.

- [ ] **Step 2: Typecheck both workspaces**

Run: `yarn workspace @trm/server typecheck && yarn workspace @trm/admin typecheck`
Expected: no errors.

- [ ] **Step 3: Manually confirm the two behaviours (verify skill)**

Follow the `verify` skill against the real admin app: (a) open Rooms, click a row → the detail drawer opens with host/members/settings and no seed field; inline Close/Delete still work and mirror inside the drawer. (b) With `TRM_PERSISTENCE=1`, trigger/observe an auto purge that deletes nothing → no new `purge.run` row appears in the Purge view's recent-runs table; a manual "Run now" at 0/0 still appears.

- [ ] **Step 4: Refresh the knowledge graph**

Run: `graphify update .`
Expected: graph updated (AST-only, no API cost).

---

## Self-review

**Spec coverage:**
- Part 1 (auto no-op skip, manual always logs) → Task 1. ✓
- Part 2 server detail endpoint, seed-redacted → Task 2. ✓
- Part 2 router union + REST client → Task 3. ✓
- Part 2 clickable rows + inline-and-drawer actions + i18n → Task 4. ✓
- Tests (server auto/manual skip, room detail omits seed, client row-click) → Tasks 1, 2, 4. ✓
- Scope guard (no threshold/lobby/game-detail changes) → honored; only additive endpoint + view changes. ✓

**Placeholder scan:** none — every code and test block is complete.

**Type consistency:** `RoomDetail` fields match across `DashboardRoomDetailSchema` (Task 2), the server `roomDetail` return (Task 2), and the client `RoomDetail` interface (Task 3): `settings.map.{source,id}`, `members[].{isBot,isGuest,ready,difficulty?}`, `gameStatus?`, `hostName?`. `openDetail`/`closeDetail` accept `'rooms'` (Task 3) and are called with `'rooms'` (Task 4). `statusKey`/`aspectForStatus`/`shortId`/`fmtDateTime` are the existing helpers used unchanged.
