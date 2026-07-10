# Full-Room Join Falls Back to Spectating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /rooms/:code/join` on a full `LOBBY` room seats the joiner as a spectator instead of
400ing, and the web client shows a one-time notice when that happens.

**Architecture:** One server-side change (`RoomRepo.join` gains a spectate-fallback branch, gated by
the room's existing `allowSpectating` setting) and two client-side changes (the two call sites that
hit `POST :code/join` detect the fallback from the response and push an existing toast notification).
No new types, no new endpoints, no new client state.

**Tech Stack:** NestJS + MongoDB (native driver) on the server; React + Zustand on the web client;
Vitest + Supertest for server e2e; Vitest + Testing Library for web component tests.

## Global Constraints

- No spectator cap — matches the existing unlimited-spectator behavior for started games.
- No change to `addBot`, `becomePlayer`, or any other `'full'`-returning path — only human `join()`
  against a full `LOBBY` room gets the fallback.
- No auto-promotion of a spectator into a seat that frees up — `join()` never promotes a spectator to
  a seat, full or not; that stays the explicit, manual `becomePlayer`/`rejoinRoom` action.
- The fallback is gated by the room's existing `allowSpectating` setting (default `true`) — when
  `false`, a full room still 400s "room is full" exactly as today.
- UI copy ships in Traditional Chinese (primary) + English, per this repo's i18n convention.
- Spec: `docs/superpowers/specs/2026-07-11-full-room-join-as-spectator-design.md`.

---

### Task 1: Server — `RoomRepo.join` falls back to spectating on a full lobby

**Files:**
- Modify: `apps/server/src/lobby/room.repo.ts:206-230` (the `join` method)
- Test: Create `apps/server/test/lobby-full-join-spectate.e2e.spec.ts`

**Interfaces:**
- Consumes: `RoomDoc`, `RoomSpectator`, `DEFAULT_ROOM_SETTINGS`, `JoinResult` — all already defined
  in `apps/server/src/lobby/room.repo.ts` (no changes to these types).
- Produces: `RoomRepo.join(code, member)` still returns `Promise<JoinResult>`
  (`RoomDoc | 'not_found' | 'full' | 'started' | 'already'`) — same signature, same return type, only
  the full-room branch's behavior changes. `LobbyService.join` (`apps/server/src/lobby/lobby.service.ts:165-176`)
  needs **no code change** — it only throws on the literal `'full'` string, which `join` now only
  returns when the room disables spectating.

- [ ] **Step 1: Write the failing e2e tests**

Create `apps/server/test/lobby-full-join-spectate.e2e.spec.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from './app';

let t: TestApp;
const server = () => t.app.getHttpServer();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guest(displayName: string): Promise<{ token: string; id: string }> {
  const res = await request(server()).post('/api/v1/auth/guest').send({ displayName }).expect(201);
  return { token: res.body.accessToken, id: res.body.user.id };
}

beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

describe('lobby: join falls back to spectating when full', () => {
  it('seats a joiner as a spectator when the lobby is full and spectating is allowed', async () => {
    const a = await guest('Ada');
    const b = await guest('Bo');
    const c = await guest('Cy');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);

    const joined = await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(c.token))
      .expect(200);
    expect(joined.body.status).toBe('LOBBY');
    expect(joined.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id, b.id]);
    expect(joined.body.spectators).toEqual([{ userId: c.id, displayName: 'Cy', isGuest: true }]);
  });

  it('still rejects a full room when spectating is disabled', async () => {
    const a = await guest('Ada2');
    const b = await guest('Bo2');
    const c = await guest('Cy2');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    await request(server())
      .patch(`/api/v1/rooms/${code}/settings`)
      .set(auth(a.token))
      .send({ allowSpectating: false })
      .expect(200);

    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(400);
  });

  it('does not promote a full-room spectator to a freed seat on a repeat join', async () => {
    const a = await guest('Ada3');
    const b = await guest('Bo3');
    const c = await guest('Cy3');
    const room = await request(server())
      .post('/api/v1/rooms')
      .set(auth(a.token))
      .send({ maxPlayers: 2 })
      .expect(201);
    const code: string = room.body.code;
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(b.token)).expect(200);
    // c lands as a spectator (room full)
    await request(server()).post(`/api/v1/rooms/${code}/join`).set(auth(c.token)).expect(200);
    // b leaves, freeing a seat
    await request(server()).post(`/api/v1/rooms/${code}/leave`).set(auth(b.token)).expect(200);

    const rejoined = await request(server())
      .post(`/api/v1/rooms/${code}/join`)
      .set(auth(c.token))
      .expect(200);
    expect(rejoined.body.members.map((m: { userId: string }) => m.userId)).toEqual([a.id]);
    expect(rejoined.body.spectators).toEqual([{ userId: c.id, displayName: 'Cy3', isGuest: true }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/server test --run lobby-full-join-spectate`
Expected: The first test FAILs — `joined.body.status` request returns 400 ("room is full") instead
of 200, because `RoomRepo.join` still unconditionally returns `'full'` at capacity.

- [ ] **Step 3: Implement the fallback in `RoomRepo.join`**

In `apps/server/src/lobby/room.repo.ts`, replace the `join` method (currently lines 206-230):

```ts
  /** Atomic join: CAS on the member-count so concurrent joiners get distinct seats. A full LOBBY
   *  room falls back to seating the joiner as a spectator (unless the room disables spectating).
   *  join() never promotes an existing spectator to a seat, full room or not — that stays the
   *  explicit becomePlayer/rejoin action. */
  async join(code: string, member: Omit<RoomMember, 'seat' | 'ready'>): Promise<JoinResult> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = await this.col.findOne({ _id: code });
      if (!room) return 'not_found';
      if (room.status !== 'LOBBY') return 'started';
      if (room.members.some((m) => m.userId === member.userId)) return 'already';
      if (room.spectators?.some((s) => s.userId === member.userId)) return room;

      if (room.members.length >= room.maxPlayers) {
        const settings = { ...DEFAULT_ROOM_SETTINGS, ...room.settings };
        if (!settings.allowSpectating) return 'full';
        const spectator: RoomSpectator = {
          userId: member.userId,
          displayName: member.displayName,
          isGuest: member.isGuest,
        };
        await this.col.updateOne(
          { _id: code, 'spectators.userId': { $ne: member.userId } },
          { $push: { spectators: spectator }, $set: { updatedAt: new Date() } },
        );
        return (await this.col.findOne({ _id: code })) ?? 'not_found';
      }

      const seat = room.members.length;
      const res = await this.col.updateOne(
        {
          _id: code,
          status: 'LOBBY',
          members: { $size: seat },
          'members.userId': { $ne: member.userId },
        },
        { $push: { members: { ...member, seat, ready: false } }, $set: { updatedAt: new Date() } },
      );
      if (res.modifiedCount === 1) {
        const updated = await this.col.findOne({ _id: code });
        if (updated) return updated;
      }
    }
    throw new Error('join contention');
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/server test --run lobby-full-join-spectate`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full server suite to check for regressions**

Run: `yarn workspace @trm/server test --run lobby`
Expected: PASS — in particular `lobby-demote.e2e.spec.ts` and `lobby-spectate.e2e.spec.ts` (existing
spectator behavior) and `lobby.e2e.spec.ts`/similar (existing plain-join behavior) still pass
unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lobby/room.repo.ts apps/server/test/lobby-full-join-spectate.e2e.spec.ts
git commit -m "feat(server): fall back to spectating when joining a full lobby"
```

---

### Task 2: Web — `HomeScreen` shows a one-time notice on spectate fallback

**Files:**
- Modify: `apps/web/src/i18n/index.ts` (add `fullRoomSpectateNotice`, zh block ~line 129 and en block
  ~line 708)
- Modify: `apps/web/src/screens/HomeScreen.tsx` (imports, `pushNotification` hook, `join()`)
- Test: Modify `apps/web/src/screens/HomeScreen.test.tsx`

**Interfaces:**
- Consumes: `useAnimationsStore` + `NotificationCue` variant `'notice'` from
  `apps/web/src/store/animations.ts` (existing — `pushNotification({ variant: 'notice', text })`, no
  changes needed there). `RoomView.members` / `RoomView.spectators` from `apps/web/src/net/rest.ts`
  (existing, unchanged).
- Produces: no new exports — this task only changes `join()`'s internal behavior in `HomeScreen`.

- [ ] **Step 1: Add the i18n string**

In `apps/web/src/i18n/index.ts`, in the zh-Hant block (near line 129), change:

```ts
      spectatingHint: '你正在觀戰，無法進行操作。',
```

to:

```ts
      spectatingHint: '你正在觀戰，無法進行操作。',
      fullRoomSpectateNotice: '房間已滿，你已加入為觀戰者。',
```

In the English block (near line 708), change:

```ts
      spectatingHint: "You're spectating — you can't take actions.",
```

to:

```ts
      spectatingHint: "You're spectating — you can't take actions.",
      fullRoomSpectateNotice: 'Room is full — you joined as a spectator.',
```

- [ ] **Step 2: Write the failing test**

In `apps/web/src/screens/HomeScreen.test.tsx`, add this import alongside the existing ones:

```ts
import { useAnimations } from '../store/animations';
```

Add `useAnimations.getState().reset();` to the top of the existing `beforeEach`:

```ts
  beforeEach(() => {
    vi.clearAllMocks();
    useAnimations.getState().reset();
    mocked.getPublicRooms.mockResolvedValue([]);
    mocked.getMyRooms.mockResolvedValue([]);
    mocked.history.mockResolvedValue([{ role: 'player' }]);
    useSession.setState({ user: { ...signedIn } });
    window.history.replaceState(null, '', '/');
    useUi.setState({ view: 'home', roomCode: null, gameId: null, ticket: null });
  });
```

Add this test right after the `'spectates via the code box...'` test (after line 119):

```ts
  it('joins a full lobby as a spectator and shows a one-time notice', async () => {
    mocked.getRoom.mockResolvedValue(pubRoom('FULLXX', 'LOBBY'));
    mocked.joinRoom.mockResolvedValue({
      ...pubRoom('FULLXX', 'LOBBY'),
      members: [{ userId: 'h', displayName: 'h', isGuest: false, seat: 0, ready: false }],
      spectators: [{ userId: 'u1', displayName: 'Tester', isGuest: false }],
    });
    render(<HomeScreen />);
    const input = await screen.findByLabelText('輸入房號');
    fireEvent.change(input, { target: { value: 'fullxx' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => expect(mocked.joinRoom).toHaveBeenCalledWith('FULLXX'));
    await waitFor(() =>
      expect(useAnimations.getState().notifications).toEqual([
        expect.objectContaining({ variant: 'notice', text: '房間已滿，你已加入為觀戰者。' }),
      ]),
    );
    expect(useUi.getState().roomCode).toBe('FULLXX');
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: FAIL — `useAnimations.getState().notifications` is `[]` (nothing pushes a notification yet).

- [ ] **Step 4: Implement the notice in `HomeScreen.tsx`**

Add the import (alongside the other store imports near the top of the file):

```ts
import { useAnimationsStore } from '../store/animations';
```

In `export function HomeScreen()`, add the hook next to the other `useUi` hooks (after
`const clearHomeFocus = useUi((s) => s.clearHomeFocus);`):

```ts
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
```

Replace the `join` function's body:

```ts
  const join = async () => {
    setBusy(true);
    setErr(null);
    try {
      const target = code.trim().toUpperCase();
      const r = await api.getRoom(target);
      if (r.status === 'STARTED' && r.settings.allowSpectating) {
        const tk = await api.spectate(target);
        connectGame(tk.ticket, { roomCode: target, spectator: true });
        // Same as watch() above: establish roomCode + the /room/:code URL before entering.
        enterRoom(target);
        enterGame(tk.gameId, tk.ticket);
      } else {
        const joined = await api.joinRoom(target);
        // A full room seats the joiner as a spectator instead of rejecting the join — tell
        // them once, since they expected a seat.
        if (
          !joined.members.some((m) => m.userId === user.id) &&
          joined.spectators.some((s) => s.userId === user.id)
        ) {
          pushNotification({ variant: 'notice', text: t('fullRoomSpectateNotice') });
        }
        enterRoom(joined.code);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/index.ts apps/web/src/screens/HomeScreen.tsx apps/web/src/screens/HomeScreen.test.tsx
git commit -m "feat(web): notify on the home screen when a full-room join lands as a spectator"
```

---

### Task 3: Web — `RoomScreen`'s auto-join shows the same one-time notice

**Files:**
- Modify: `apps/web/src/screens/RoomScreen.tsx` (the poll effect, ~lines 100-190)
- Test: Modify `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**
- Consumes: `pushNotification` from `useAnimationsStore` — already imported and destructured in
  `RoomScreen.tsx:71` (`const pushNotification = useAnimationsStore((s) => s.pushNotification);`),
  no new import needed. `fullRoomSpectateNotice` i18n key — added in Task 2 (this task takes a hard
  dependency on Task 2 having landed first).
- Produces: nothing new exported — this task only changes behavior inside the poll effect.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/screens/RoomScreen.test.tsx`, add this test inside the existing
`describe('RoomScreen join-via-link', ...)` block, right after the `'stops polling after a terminal
join failure...'` test (after line 162, before the block's closing `});`):

```ts
  it('joins a full room as a spectator and shows a one-time notice', async () => {
    mocked.getRoom.mockResolvedValue(room()); // members = [host] only — I am not in it
    mocked.joinRoom.mockResolvedValue(
      room({
        members: [member('host')],
        spectators: [{ userId: 'u-me', displayName: 'Me', isGuest: true }],
      }),
    );
    render(<RoomScreen />);
    await waitFor(() => expect(mocked.joinRoom).toHaveBeenCalledWith('ABCD'));
    expect(await screen.findByText('房間已滿，你已加入為觀戰者。')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: FAIL — the notice text never appears (nothing pushes it yet).

- [ ] **Step 3: Implement the notice in the poll effect**

In `apps/web/src/screens/RoomScreen.tsx`, inside the poll effect, change:

```ts
          // A lobby non-member who isn't a spectator joins a seat once; a demoted spectator
          // falls through to keep watching the lobby (never auto-rejoined onto a seat).
          if (!amSpectator) {
            r = await api.joinRoom(code);
            if (!active) return;
          }
```

to:

```ts
          // A lobby non-member who isn't a spectator joins a seat once; a demoted spectator
          // falls through to keep watching the lobby (never auto-rejoined onto a seat).
          if (!amSpectator) {
            r = await api.joinRoom(code);
            if (!active) return;
            // A full room seats the joiner as a spectator instead of rejecting the join —
            // tell them once, since they expected a seat.
            if (
              !r.members.some((m) => m.userId === user?.id) &&
              r.spectators.some((s) => s.userId === user?.id)
            ) {
              pushNotification({ variant: 'notice', text: t('fullRoomSpectateNotice') });
            }
          }
```

Then update the effect's dependency array (currently `}, [code, user?.id, enterGame, goHome]);`) to
include `pushNotification`:

```ts
  }, [code, user?.id, enterGame, goHome, pushNotification]);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS.

- [ ] **Step 5: Run the full web suite to check for regressions**

Run: `yarn workspace @trm/web test --run RoomScreen && yarn workspace @trm/web test --run HomeScreen`
Expected: PASS (both files, all tests).

- [ ] **Step 6: Typecheck and lint the whole change**

Run: `yarn typecheck && yarn lint`
Expected: PASS, no errors in the touched files.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "feat(web): notify in-room when a full-room auto-join lands as a spectator"
```
