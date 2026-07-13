# Transferable Room Owners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a room's host hand off ownership without leaving the room, and let a dashboard maintainer reassign a stuck LOBBY room's host.

**Architecture:** Both surfaces reuse the existing `hostId` / transfer-validation rules already shipped for the leave-flow transfer. The player surface is UI-only (the endpoint already supports staying seated after transfer). The admin surface adds one new host-agnostic repo method, one new permission, one new endpoint, and one new UI action, mirroring the existing `close`/`delete` admin room actions exactly.

**Tech Stack:** NestJS (server), React + Vite + TS (web, admin), vitest + supertest (tests), Zod-based `ModerationReasonDto`.

## Global Constraints

- LOBBY-only on both surfaces — no transfer once a game has started.
- Transfer targets are seated, non-bot members only, on both surfaces — no promoting spectators, no bot hosts.
- No new transfer _semantics_ — both surfaces validate against the same rules the existing player-facing `transferHost` already enforces.
- `rooms.transferHost` is a new dashboard permission at the **moderator** tier (same tier as `rooms.close`).
- The admin `reason` field is **optional**, matching every other `ModerationReasonDto`-based moderation endpoint (`rooms.close`, `rooms.delete`, ...) — never hard-required.
- Follow existing patterns exactly: the admin transfer action reuses `ConfirmDialog withReason` (not a new dialog type); the player transfer action reuses `useConfirmAction` + `ConfirmDialog` (not a new dialog type).

---

### Task 1: `rooms.transferHost` dashboard permission

**Files:**

- Modify: `packages/shared/src/dashboard.ts`
- Test: `packages/shared/src/dashboard.test.ts`

**Interfaces:**

- Produces: `'rooms.transferHost'` as a member of `DashboardPermission` (used by Task 2's `@RequirePermission('rooms.transferHost')` and Task 4's `hasPermission('rooms.transferHost')`).

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/dashboard.test.ts`:

```ts
it('includes rooms.transferHost as a known permission, granted at the moderator tier', () => {
  expect(DASHBOARD_PERMISSIONS).toContain('rooms.transferHost');
  expect(ROLE_PERMISSIONS.moderator).toContain('rooms.transferHost');
  expect(effectivePermissions('moderator').has('rooms.transferHost')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: FAIL — `expect(received).toContain(expected)` on `'rooms.transferHost'`.

- [ ] **Step 3: Add the permission**

In `packages/shared/src/dashboard.ts`, add `'rooms.transferHost'` to `DASHBOARD_PERMISSIONS` (right after `'rooms.close'`):

```ts
export const DASHBOARD_PERMISSIONS = [
  'overview.read',
  'users.read',
  'users.ban',
  'users.tutorialReset',
  'users.delete',
  'users.features',
  'games.read',
  'games.readLog',
  'games.terminate',
  'games.delete',
  'games.viewReplay',
  'games.spectateLive',
  'rooms.read',
  'rooms.close',
  'rooms.transferHost',
  'rooms.delete',
  'maintainers.read',
  'maintainers.write',
  'audit.read',
  'purge.read',
  'purge.run',
  'maps.read',
  'maps.moderate',
  'ratings.read',
  'config.features',
] as const;
```

And add it to `MODERATOR_PERMISSIONS` (right after `'rooms.close'`):

```ts
const MODERATOR_PERMISSIONS: readonly DashboardPermission[] = [
  ...VIEWER_PERMISSIONS,
  'users.ban',
  'users.tutorialReset',
  'games.readLog',
  'games.terminate',
  'rooms.close',
  'rooms.transferHost',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @trm/shared test --run dashboard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/dashboard.ts packages/shared/src/dashboard.test.ts
git commit -m "feat(shared): add rooms.transferHost dashboard permission"
```

---

### Task 2: Server — admin host-reassignment endpoint

**Files:**

- Modify: `apps/server/src/lobby/room.repo.ts` (add `transferHostAdmin`)
- Modify: `apps/server/src/dashboard/audit.repo.ts` (add `'room.transferHost'` audit action)
- Modify: `apps/server/src/dashboard/dashboard-games.service.ts` (add `transferHost`)
- Modify: `apps/server/src/dashboard/dashboard-games.controller.ts` (add the route)
- Test: `apps/server/test/dashboard-terminate.e2e.spec.ts`

**Interfaces:**

- Consumes: `TransferHostResult` (`RoomDoc | 'not_found' | 'forbidden' | 'started' | 'invalid'`, already exported from `room.repo.ts:110`), `ModerationReasonDto` / `ModerationReasonSchema` (`dashboard.schemas.ts:42-45`), `RequirePermission` decorator, `AuditService.log`.
- Produces: `RoomRepo.transferHostAdmin(code: string, targetId: string): Promise<TransferHostResult>`; `DashboardGamesService.transferHost(actor: AuthUser, code: string, targetId: string, reason?: string): Promise<ReturnType<typeof toRoomRow>>`; route `POST /api/v1/dashboard/rooms/:code/transfer/:userId`.

- [ ] **Step 1: Write the failing e2e test**

Add to `apps/server/test/dashboard-terminate.e2e.spec.ts`, after the existing `describe('force-close room', ...)` block:

```ts
describe('admin transfer host', () => {
  it('reassigns the host of a LOBBY room, keeping the old host seated, and audits it', async () => {
    const a = await guest('Cass');
    const b = await guest('Drew');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const res = await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${b.userId}`)
      .set(auth(moderator.token))
      .send({ reason: 'host went AFK' })
      .expect(200);
    expect(res.body.hostId).toBe(b.userId);
    expect(res.body.members.map((m: { userId: string }) => m.userId)).toContain(a.userId);
    expect(
      await t.db.collection('dashboardAudit').countDocuments({
        action: 'room.transferHost',
        'target.id': code,
      } as never),
    ).toBe(1);
  });

  it('404s an unknown room, 400s an invalid target, 409s a STARTED room', async () => {
    const a = await guest('Ellis');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;

    await request(server())
      .post(`/api/v1/dashboard/rooms/nope/transfer/${a.userId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(404);

    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/nobody`)
      .set(auth(moderator.token))
      .send({})
      .expect(400);

    await request(server())
      .post(`/api/v1/rooms/${code}/bots`)
      .set(auth(a.token))
      .send({ difficulty: 'EASY' })
      .expect(200);
    const roomDoc = await t.db.collection('rooms').findOne({ _id: code } as never);
    const botId = (
      roomDoc as unknown as { members: { userId: string; isBot?: boolean }[] }
    ).members.find((m) => m.isBot)!.userId;
    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${botId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(400);

    const b = await guest('Fran');
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    for (const u of [a, b]) {
      await request(server())
        .post(`/api/v1/rooms/${code}/ready`)
        .set(auth(u.token))
        .send({ ready: true })
        .expect(200);
    }
    await request(server()).post(`/api/v1/rooms/${code}/start`).set(auth(a.token)).expect(200);
    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${b.userId}`)
      .set(auth(moderator.token))
      .send({})
      .expect(409);
  }, 60_000);

  it('403s without the rooms.transferHost permission', async () => {
    const viewerRes = await request(server())
      .post('/api/v1/auth/register')
      .send({
        email: 'viewer-transfer@example.com',
        password: 'password123',
        displayName: 'Viewer',
      })
      .expect(201);
    const viewer = {
      userId: viewerRes.body.user.id as string,
      token: viewerRes.body.accessToken as string,
    };
    await t.db.collection('dashboardAccounts').insertOne({
      _id: viewer.userId,
      role: 'viewer',
      grantedBy: 'test',
      grantedAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const a = await guest('Gale');
    const b = await guest('Hart');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({})
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    await request(server())
      .post(`/api/v1/dashboard/rooms/${code}/transfer/${b.userId}`)
      .set(auth(viewer.token))
      .send({})
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/server test --run dashboard-terminate`
Expected: FAIL — first assertion 404s (route doesn't exist yet, Nest returns 404 for the unmatched path).

- [ ] **Step 3: Add the audit action**

In `apps/server/src/dashboard/audit.repo.ts`, add `'room.transferHost'` to `DashboardAuditAction` (right after `'room.close'`):

```ts
export type DashboardAuditAction =
  | 'bootstrap.grant'
  | 'user.ban'
  | 'user.unban'
  | 'user.features'
  | 'user.tutorialReset'
  | 'user.delete'
  | 'game.terminate'
  | 'game.delete'
  | 'game.viewReplay'
  | 'game.spectateLive'
  | 'room.close'
  | 'room.transferHost'
  | 'room.delete'
  | 'purge.run'
  | 'maintainer.grant'
  | 'maintainer.update'
  | 'maintainer.revoke'
  | 'map.delete'
  | 'map.unshare'
  | 'map.transfer'
  | 'config.features';
```

- [ ] **Step 4: Add the repo method**

In `apps/server/src/lobby/room.repo.ts`, add right after `transferHost` (after line 560):

```ts
  /** Maintainer force-reassignment: same target validation as transferHost, no caller-is-host check. */
  async transferHostAdmin(code: string, targetId: string): Promise<TransferHostResult> {
    const room = await this.col.findOne({ _id: code });
    if (!room) return 'not_found';
    if (room.status !== 'LOBBY') return 'started';
    const target = room.members.find((m) => m.userId === targetId);
    if (!target || target.isBot || targetId === room.hostId) return 'invalid';
    await this.col.updateOne(
      { _id: code, status: 'LOBBY' },
      { $set: { hostId: targetId, updatedAt: new Date() } },
    );
    return (await this.col.findOne({ _id: code })) ?? 'not_found';
  }
```

- [ ] **Step 5: Add the service method**

In `apps/server/src/dashboard/dashboard-games.service.ts`, add right after `closeRoom` (after line 191). It needs `BadRequestException` — check the existing import at line 1 and extend it:

```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
```

```ts
  /** Maintainer reassignment of a LOBBY room's host — not gated on being the current host. */
  async transferHost(actor: AuthUser, code: string, targetId: string, reason?: string) {
    const r = await this.rooms.transferHostAdmin(code, targetId);
    if (r === 'not_found') throw new NotFoundException('room not found');
    if (r === 'started') throw new ConflictException('room is no longer in LOBBY');
    if (r === 'invalid') throw new BadRequestException('cannot transfer to that player');
    await this.audit.log(
      actor,
      'room.transferHost',
      { type: 'room', id: code },
      { targetId, ...(reason ? { reason } : {}) },
    );
    return toRoomRow(r);
  }
```

- [ ] **Step 6: Add the controller route**

In `apps/server/src/dashboard/dashboard-games.controller.ts`, add right after `closeRoom` (after line 174, before `@Delete('rooms/:code')`):

```ts
  @Post('rooms/:code/transfer/:userId')
  @HttpCode(200)
  @RequirePermission('rooms.transferHost')
  @ApiOperation({
    summary: "Reassign a LOBBY room's host to another seated, non-bot member",
  })
  @ApiBody({ schema: apiSchema(ModerationReasonSchema) })
  @ApiResponse({ status: 200, schema: apiSchema(DashboardRoomRowSchema) })
  transferHost(
    @Param('code') code: string,
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthUser,
    @Body() body: ModerationReasonDto,
  ) {
    return this.games.transferHost(actor, code, userId, body.reason);
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `yarn workspace @trm/server test --run dashboard-terminate`
Expected: PASS (all three new `it`s green, plus the pre-existing tests in the file still pass).

- [ ] **Step 8: Typecheck and commit**

Run: `yarn workspace @trm/server typecheck`
Expected: no errors.

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/src/dashboard/audit.repo.ts apps/server/src/dashboard/dashboard-games.service.ts apps/server/src/dashboard/dashboard-games.controller.ts apps/server/test/dashboard-terminate.e2e.spec.ts
git commit -m "feat(server): let a maintainer reassign a LOBBY room's host"
```

---

### Task 3: Web — standalone "make owner" while staying in the room

**Files:**

- Modify: `apps/web/src/screens/RoomScreen.tsx`
- Modify: `apps/web/src/i18n/index.ts`
- Test: `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**

- Consumes: `api.transferOwnership(code: string, userId: string): Promise<RoomView>` (already exists, `net/rest.ts:371`); `useConfirmAction()` (`hooks/useConfirmAction.ts`); `ConfirmDialog` (`components/ConfirmDialog.tsx`).
- Produces: no new exports — this is a leaf UI change.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/screens/RoomScreen.test.tsx`, after the `describe('RoomScreen kick', ...)` block:

```tsx
describe('RoomScreen ownership transfer', () => {
  const meHost = { userId: 'u-me', displayName: 'Me', isGuest: true, seat: 0, ready: false };
  const guestMember = { userId: 'g1', displayName: 'Guest', isGuest: true, seat: 1, ready: false };

  it('lets the host make another member the owner without leaving', async () => {
    mocked.getRoom.mockResolvedValue(room({ hostId: 'u-me', members: [meHost, guestMember] }));
    (api.transferOwnership as ReturnType<typeof vi.fn>).mockResolvedValue(
      room({ hostId: 'g1', members: [meHost, guestMember] }),
    );
    render(<RoomScreen />);
    const makeOwnerBtn = await screen.findByRole('button', { name: '設為房主' });
    fireEvent.click(makeOwnerBtn);
    expect(api.transferOwnership).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    await waitFor(() => expect(api.transferOwnership).toHaveBeenCalledWith('ABCD', 'g1'));
    expect(useUi.getState().view).toBe('room');
  });

  it('shows no make-owner button to a non-host', async () => {
    mocked.getRoom.mockResolvedValue(room({ members: [member('host'), member('u-me')] }));
    render(<RoomScreen />);
    await screen.findByText('host');
    expect(screen.queryByRole('button', { name: '設為房主' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — `Unable to find role="button" and name "設為房主"`.

- [ ] **Step 3: Add i18n keys**

In `apps/web/src/i18n/index.ts`, in the **zh** block, add right after `host: '房主',` (line 141):

```ts
      host: '房主',
      makeOwner: '設為房主',
```

And right after `closeRoomConfirmBody: '這會將所有人移出並關閉房間，確定嗎？',` (line 237):

```ts
      closeRoomConfirmBody: '這會將所有人移出並關閉房間，確定嗎？',
      transferConfirmTitle: '設為新房主？',
      transferConfirmBody: '你將失去房主權限，確定要將房主移轉給這位玩家嗎？',
```

In the **en** block, right after `host: 'Host',` (line 724):

```ts
      host: 'Host',
      makeOwner: 'Make owner',
```

And right after `closeRoomConfirmBody: 'This removes everyone and closes the room. Are you sure?',` (line 822):

```ts
      closeRoomConfirmBody: 'This removes everyone and closes the room. Are you sure?',
      transferConfirmTitle: 'Make new owner?',
      transferConfirmBody: 'You will lose host controls. Transfer ownership to this player?',
```

- [ ] **Step 4: Add the button, confirm dialog, and handler**

In `apps/web/src/screens/RoomScreen.tsx`, add `Crown` to the lucide-react import (line 3):

```tsx
import { Bot, Crown, Globe, Lock, Map as MapIcon, UserMinus, X } from 'lucide-react';
```

Add a fourth `useConfirmAction` instance, right after the `closeOpen` one (after line 83):

```tsx
const {
  open: transferOpen,
  request: requestTransfer,
  confirm: confirmTransfer,
  cancel: cancelTransfer,
} = useConfirmAction();
```

Add the handler next to `kick` (after line 256):

```tsx
const kick = (userId: string) => void guard(api.kickPlayer(code, userId));
const transferHost = (userId: string) => void guard(api.transferOwnership(code, userId));
```

Add the button in the member row, right after the existing kick button (after line 352, still inside the `<li>`):

```tsx
{
  isHost && !m.isBot && m.userId !== room.hostId && (
    <button
      className="icon-btn"
      aria-label={t('makeOwner')}
      title={t('makeOwner')}
      onClick={() => requestTransfer(() => transferHost(m.userId))}
    >
      <Crown size={14} aria-hidden />
    </button>
  );
}
{
  isHost && !m.isBot && m.userId !== room.hostId && (
    <button
      className="icon-btn"
      aria-label={t('kickPlayer')}
      title={t('kickPlayer')}
      onClick={() => kick(m.userId)}
    >
      <UserMinus size={14} aria-hidden />
    </button>
  );
}
```

(This replaces the single existing kick-button block — the make-owner button goes first, the existing kick button block stays exactly as-is right after it.)

Add the dialog, right after the `closeOpen` dialog block (after line 589):

```tsx
{
  transferOpen && (
    <ConfirmDialog
      title={t('transferConfirmTitle')}
      message={t('transferConfirmBody')}
      onConfirm={confirmTransfer}
      onCancel={cancelTransfer}
    />
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS

- [ ] **Step 6: Typecheck and commit**

Run: `yarn workspace @trm/web typecheck`
Expected: no errors.

```bash
git add apps/web/src/screens/RoomScreen.tsx apps/web/src/i18n/index.ts apps/web/src/screens/RoomScreen.test.tsx
git commit -m "feat(web): let the host make another player the owner without leaving"
```

---

### Task 4: Admin — dashboard host reassignment

**Files:**

- Modify: `apps/admin/src/net/rest.ts`
- Modify: `apps/admin/src/views/RoomsView.tsx`
- Modify: `apps/admin/src/i18n/index.ts`
- Test: `apps/admin/src/views/RoomsView.test.tsx`

**Interfaces:**

- Consumes: `POST /dashboard/rooms/:code/transfer/:userId` (Task 2); `RoomRow`/`RoomDetail` (`net/rest.ts:113-155`); `useSession().hasPermission('rooms.transferHost')`; `ConfirmDialog` (`components/ConfirmDialog.tsx`, `withReason` prop).
- Produces: `api.transferRoomHost(code: string, userId: string, reason?: string): Promise<RoomRow>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/admin/src/views/RoomsView.test.tsx`, after the `describe('RoomsView detail drawer', ...)` block:

```tsx
describe('RoomsView transfer host', () => {
  const ROOM_DETAIL_TWO = {
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
      { userId: 'p2', displayName: 'Payton', seat: 1, isBot: false, isGuest: false, ready: false },
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
  };

  beforeEach(() => {
    useToast.getState().reset();
    useSession.setState({
      phase: 'ready',
      user: { id: 'u1', displayName: 'Ops', isGuest: false },
      role: 'admin',
      permissions: new Set(['rooms.read', 'rooms.transferHost']),
    });
  });

  it('reassigns the host from the member list and closes the drawer', async () => {
    stubFetch({
      '/dashboard/rooms/ABCD/transfer/p2': { status: 200, body: { ...ROOM_ROW, hostId: 'p2' } },
      '/dashboard/rooms/ABCD': { status: 200, body: ROOM_DETAIL_TWO },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(
      <>
        <RoomsView />
        <ToastStack />
      </>,
    );
    fireEvent.click(await screen.findByText('ABCD'));
    fireEvent.click(await screen.findByText('設為房主'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '設為房主' }));
    expect(await screen.findByText('房主已轉移')).toBeInTheDocument();
    expect(screen.queryByText('房間詳情 · ABCD')).not.toBeInTheDocument();
  });

  it('hides the make-owner action without the permission', async () => {
    useSession.setState({ permissions: new Set(['rooms.read']) });
    stubFetch({
      '/dashboard/rooms/ABCD': { status: 200, body: ROOM_DETAIL_TWO },
      '/dashboard/rooms?': { status: 200, body: { rooms: [ROOM_ROW], nextCursor: null } },
    });
    render(<RoomsView />);
    fireEvent.click(await screen.findByText('ABCD'));
    await screen.findByText('Payton');
    expect(screen.queryByText('設為房主')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @trm/admin test --run RoomsView`
Expected: FAIL — `Unable to find an element with the text: 設為房主`.

- [ ] **Step 3: Add i18n keys**

In `apps/admin/src/i18n/index.ts`, **zh** `rooms` block, right after `members: '成員',` (line 223):

```ts
    members: '成員',
    transferHost: '設為房主',
    transferConfirmTitle: '將房主轉移給此成員？',
    transferConfirmBody: '此操作會立即變更房間的房主。',
```

**zh** `toast` block, right after `roomDeleted: '房間已刪除',` (line 52):

```ts
    roomDeleted: '房間已刪除',
    roomHostTransferred: '房主已轉移',
```

**en** `rooms` block, right after `members: 'Members',` (line 619):

```ts
    members: 'Members',
    transferHost: 'Make owner',
    transferConfirmTitle: 'Transfer ownership to this member?',
    transferConfirmBody: "This immediately changes the room's owner.",
```

**en** `toast` block, right after `roomDeleted: 'Room deleted',` (line 443):

```ts
    roomDeleted: 'Room deleted',
    roomHostTransferred: 'Room owner transferred',
```

- [ ] **Step 4: Add the REST call**

In `apps/admin/src/net/rest.ts`, right after `closeRoom` (after line 374), before `deleteRoom`:

```ts
  closeRoom: (code: string, reason?: string) =>
    req<RoomRow>('POST', `/dashboard/rooms/${encodeURIComponent(code)}/close`, { reason }),
  transferRoomHost: (code: string, userId: string, reason?: string) =>
    req<RoomRow>(
      'POST',
      `/dashboard/rooms/${encodeURIComponent(code)}/transfer/${encodeURIComponent(userId)}`,
      { reason },
    ),
  deleteRoom: (code: string, reason?: string) =>
    req<void>('DELETE', `/dashboard/rooms/${encodeURIComponent(code)}`, { reason }),
```

- [ ] **Step 5: Add the drawer action, dialog, and handler**

In `apps/admin/src/views/RoomsView.tsx`, add `Crown` to the lucide-react import (line 2):

```tsx
import { Crown, DoorClosed, Info, Trash2 } from 'lucide-react';
```

Update `RoomDrawer`'s props (lines 28-38) to accept the new callback:

```tsx
function RoomDrawer({
  row,
  onClose,
  onRequestClose,
  onRequestDelete,
  onRequestTransfer,
}: {
  row: RoomRow;
  onClose: () => void;
  onRequestClose: (code: string) => void;
  onRequestDelete: (code: string) => void;
  onRequestTransfer: (code: string, userId: string) => void;
}) {
```

Inside `RoomDrawer`, add the permission check next to `canClose`/`canDelete` (after line 42):

```tsx
const canClose = useSession((s) => s.hasPermission('rooms.close'));
const canDelete = useSession((s) => s.hasPermission('rooms.delete'));
const canTransferHost = useSession((s) => s.hasPermission('rooms.transferHost'));
```

Add the button inside the members-list render loop, right after the ready/not-ready badge span and still inside the enclosing `<span className="v">` (i.e. immediately before its closing tag at line 136):

```tsx
<span className="v">
  {m.isBot
    ? `${t('rooms.bot')}${m.difficulty ? ` · ${m.difficulty}` : ''}`
    : m.isGuest
      ? t('rooms.guest')
      : ''}{' '}
  <span className="oc-muted">{m.ready ? t('rooms.ready') : t('rooms.notReady')}</span>
  {canTransferHost && row.status === 'LOBBY' && !m.isBot && m.userId !== detail.hostId && (
    <button
      className="oc-btn"
      style={{ marginLeft: 6 }}
      onClick={() => onRequestTransfer(row.code, m.userId)}
    >
      <Crown size={14} aria-hidden />
      {t('rooms.transferHost')}
    </button>
  )}
</span>
```

At the top-level `RoomsView` component, add state for the pending transfer, right after `deleting` (after line 220):

```tsx
const [closing, setClosing] = useState<string | null>(null);
const [deleting, setDeleting] = useState<string | null>(null);
const [transferring, setTransferring] = useState<{ code: string; userId: string } | null>(null);
```

Add the handler, right after `close` (after line 253):

```tsx
const transferHost = async (code: string, userId: string, reason?: string) => {
  setBusy(true);
  try {
    const updated = await api.transferRoomHost(code, userId, reason);
    setRows((prev) => prev.map((r) => (r.code === code ? updated : r)));
    if (param === code) closeDetail();
    pushToast('success', t('toast.roomHostTransferred'));
  } catch (e) {
    pushToast('error', e instanceof Error ? e.message : t('common.error'));
  } finally {
    setBusy(false);
    setTransferring(null);
  }
};
```

Wire the new prop at the `RoomDrawer` render site (lines 367-374):

```tsx
{
  openRow && (
    <RoomDrawer
      row={openRow}
      onClose={closeDetail}
      onRequestClose={setClosing}
      onRequestDelete={setDeleting}
      onRequestTransfer={(code, userId) => setTransferring({ code, userId })}
    />
  );
}
```

Add the confirm dialog, right after the `deleting` dialog block (after line 403):

```tsx
{
  transferring && (
    <ConfirmDialog
      title={t('rooms.transferConfirmTitle')}
      body={t('rooms.transferConfirmBody')}
      confirmLabel={t('rooms.transferHost')}
      withReason
      busy={busy}
      onConfirm={(reason) => void transferHost(transferring.code, transferring.userId, reason)}
      onCancel={() => setTransferring(null)}
    />
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `yarn workspace @trm/admin test --run RoomsView`
Expected: PASS

- [ ] **Step 7: Typecheck and commit**

Run: `yarn workspace @trm/admin typecheck`
Expected: no errors.

```bash
git add apps/admin/src/net/rest.ts apps/admin/src/views/RoomsView.tsx apps/admin/src/i18n/index.ts apps/admin/src/views/RoomsView.test.tsx
git commit -m "feat(admin): let a maintainer reassign a LOBBY room's host"
```

---

### Task 5: Full-repo verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

```bash
yarn typecheck
yarn lint
yarn test
yarn format:check
```

Expected: all four pass with no new failures.

- [ ] **Step 2: Manual smoke check (optional but recommended)**

```bash
docker compose up -d mongo
yarn workspace @trm/server dev
yarn workspace @trm/web dev
yarn workspace @trm/admin dev
```

- Open two browser sessions, create a room in one, join with the other, and click the crown/"Make owner" icon next to the second player — confirm the dialog, verify the host badge moves and both players stay in the room.
- Log into `/admin/` as a moderator-or-above account, open a LOBBY room's detail drawer, and use "Make owner" on a non-host member — confirm the reason dialog, verify the toast and that the drawer closes.

No new step needed to commit — this task only verifies Tasks 1-4.
