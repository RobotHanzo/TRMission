# Link-only room spectating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-member who reaches a `STARTED` room via the home-page code box or a shared
`/room/:code` link spectate it (when the room allows spectating), instead of erroring or silently
bouncing home — regardless of whether the room is `PUBLIC` or `INVITE_ONLY`.

**Architecture:** Client-only fix in `apps/web`. Both entry points already fetch the room's
`RoomView` (which carries `settings.allowSpectating`) before deciding what to do next; each gets a
branch that calls the existing `POST /rooms/:code/spectate` REST endpoint (`api.spectate`) and
routes into the existing spectator game-view flow (`connectGame` + `enterGame`) instead of
dead-ending. No server or protocol changes.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react (existing test setup in both
touched files — no new tooling).

## Global Constraints

- Client-only change — do not modify `apps/server` (the `allowSpectating` gate on
  `POST /rooms/:code/spectate` already exists and is unchanged: see
  `apps/server/src/lobby/lobby.service.ts`'s `spectateTicket`).
- When `settings.allowSpectating` is `false`, behavior for a non-member on a `STARTED` room is
  unchanged: silently redirect home. Do not add new messaging for that case (confirmed with the
  user during design).
- Do not touch the un-localized raw server error strings (e.g. `'game already started'`) — out of
  scope for this fix.
- Do not change the member-reconnect path, the public-rooms list, or the `spectate` REST endpoint
  contract (`TicketResult = { gameId: string; ticket: string }`).

---

### Task 1: Spectate fallback on the direct room-link path (`RoomScreen.tsx`)

**Files:**

- Modify: `apps/web/src/screens/RoomScreen.tsx:120-141` (the poll effect's non-member branch)
- Test: `apps/web/src/screens/RoomScreen.test.tsx`

**Interfaces:**

- Consumes: `api.spectate(code: string): Promise<TicketResult>` (already exists, defined in
  `apps/web/src/net/rest.ts:312` — `TicketResult = { gameId: string; ticket: string }`);
  `connectGame(ticket: string): GameSocket` (already imported in this file, from
  `../net/connection`); `enterGame(gameId: string, ticket: string): void` (already destructured
  from `useUi` in this file, at `RoomScreen.tsx:53`).
- Produces: nothing new consumed by other tasks — this task is self-contained.

- [ ] **Step 1: Write the failing test for the spectate-allowed case**

Open `apps/web/src/screens/RoomScreen.test.tsx`. The `vi.mock('../net/rest', ...)` factory (lines
13-40) does not yet stub `spectate`. Add it alongside the other `api` methods so the mock object
looks like this (only the addition is shown — keep every existing entry):

```ts
    api: {
      getRoom: vi.fn(),
      getTicket: vi.fn(),
      joinRoom: vi.fn(),
      spectate: vi.fn(),
      setReady: vi.fn(),
      leaveRoom: vi.fn(),
      addBot: vi.fn(),
      removeBot: vi.fn(),
      kickPlayer: vi.fn(),
      startRoom: vi.fn(),
      updateRoomSettings: vi.fn(),
      listMaps: vi.fn(() => Promise.resolve([])),
      getRoomsConfig: vi.fn(() => Promise.resolve({ randomEventsEnabled: false })),
    },
```

Add `spectate` to the `mocked` type cast (lines 84-90) so the test body can reference it:

```ts
const mocked = api as unknown as {
  getRoom: ReturnType<typeof vi.fn>;
  getTicket: ReturnType<typeof vi.fn>;
  joinRoom: ReturnType<typeof vi.fn>;
  spectate: ReturnType<typeof vi.fn>;
  kickPlayer: ReturnType<typeof vi.fn>;
  updateRoomSettings: ReturnType<typeof vi.fn>;
};
```

Now replace the existing test (inside `describe('RoomScreen join-via-link', ...)`, currently
titled `'does not try to join a game already in progress that it is not part of'`) with two tests
— one for spectating allowed, one for spectating disabled (the room helper's default
`allowSpectating` is `true`, so the disabled case needs an explicit override):

```ts
  it('spectates a started room that allows it, instead of bouncing home', async () => {
    mocked.getRoom.mockResolvedValue(room({ status: 'STARTED', gameId: 'g1' })); // allowSpectating: true by default
    mocked.spectate.mockResolvedValue({ gameId: 'g1', ticket: 'spectator-ticket' });
    render(<RoomScreen />);
    await waitFor(() => expect(mocked.spectate).toHaveBeenCalledWith('ABCD'));
    await waitFor(() => expect(useUi.getState().view).toBe('game'));
    expect(useUi.getState().gameId).toBe('g1');
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });

  it('bounces home instead of spectating when the room disables it', async () => {
    mocked.getRoom.mockResolvedValue(
      room({
        status: 'STARTED',
        gameId: 'g1',
        settings: { ...baseRoom().settings, allowSpectating: false },
      }),
    );
    render(<RoomScreen />);
    await waitFor(() => expect(useUi.getState().view).toBe('home'));
    expect(mocked.joinRoom).not.toHaveBeenCalled();
    expect(mocked.spectate).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: the new `'spectates a started room that allows it...'` test FAILS (times out waiting for
`mocked.spectate` to have been called — the source still just calls `goHome()`). The
`'bounces home...'` test passes already (no source change needed for that path yet), which is
fine — it's there to pin down the behavior we must not break in Step 3.

- [ ] **Step 3: Implement the spectate fallback**

Open `apps/web/src/screens/RoomScreen.tsx`. Find this block inside the poll effect (currently
lines 120-141):

```ts
// A shared link can land a non-member here. Join the lobby once; a game already in
// progress that we aren't part of can't be joined, so bail home rather than trap.
// (Existing members of a STARTED game skip this and reconnect via the ticket below —
// the server rejects join on a started room even for members.)
if (!r.members.some((m) => m.userId === user?.id)) {
  if (wasMember) {
    // We were seated and have been dropped. In LOBBY that's a host kick — surface a
    // modal and let the player dismiss it home; otherwise just bail home.
    active = false;
    if (r.status === 'LOBBY') setKicked(true);
    else goHome();
    return;
  }
  // A started game we aren't in can't be joined: bail home rather than trap.
  if (r.status !== 'LOBBY') {
    active = false;
    goHome();
    return;
  }
  r = await api.joinRoom(code);
  if (!active) return;
}
```

Replace it with:

```ts
// A shared link can land a non-member here. Join the lobby once; a game already in
// progress that we aren't part of can't be joined, so spectate instead if the room
// allows it, otherwise bail home rather than trap.
// (Existing members of a STARTED game skip this and reconnect via the ticket below —
// the server rejects join on a started room even for members.)
if (!r.members.some((m) => m.userId === user?.id)) {
  if (wasMember) {
    // We were seated and have been dropped. In LOBBY that's a host kick — surface a
    // modal and let the player dismiss it home; otherwise just bail home.
    active = false;
    if (r.status === 'LOBBY') setKicked(true);
    else goHome();
    return;
  }
  if (r.status !== 'LOBBY') {
    // A started game we aren't in can't be joined — spectate if it's allowed,
    // otherwise bail home rather than trap.
    if (r.status === 'STARTED' && r.gameId && r.settings.allowSpectating) {
      const tk = await api.spectate(code);
      if (!active) return;
      connectGame(tk.ticket);
      enterGame(tk.gameId, tk.ticket);
      return;
    }
    active = false;
    goHome();
    return;
  }
  r = await api.joinRoom(code);
  if (!active) return;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: PASS — all tests in `RoomScreen.test.tsx`, including both new ones.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/RoomScreen.tsx apps/web/src/screens/RoomScreen.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): spectate a started room from a shared link when allowed

A non-member opening /room/:code for a STARTED room always bounced
home, even when the room's allowSpectating flag was on — the only
way to spectate was the public-rooms list, so an INVITE_ONLY room's
own link could never be used to watch it.
EOF
)"
```

---

### Task 2: Spectate fallback on the home-page code-box path (`HomeScreen.tsx`)

**Files:**

- Modify: `apps/web/src/screens/HomeScreen.tsx:166-176` (the `join()` handler)
- Test: `apps/web/src/screens/HomeScreen.test.tsx`

**Interfaces:**

- Consumes: `api.getRoom(code: string): Promise<RoomView>` (already exists, defined in
  `apps/web/src/net/rest.ts:292`); `api.spectate(code: string): Promise<TicketResult>`; the
  already-imported `connectGame` and `enterGame` (destructured at `HomeScreen.tsx:62`) — same
  signatures as Task 1.
- Produces: nothing new consumed by other tasks — this task is self-contained. Independent of
  Task 1 (touches a different file); can be done in either order.

- [ ] **Step 1: Write the failing test**

Open `apps/web/src/screens/HomeScreen.test.tsx`. The `vi.mock('../net/rest', ...)` factory (lines
11-22) does not yet stub `getRoom`. Add it so the mock object looks like this (only the addition
is shown — keep every existing entry):

```ts
  api: {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    getRoom: vi.fn(),
    getPublicRooms: vi.fn(() => Promise.resolve([])),
    getMyRooms: vi.fn(() => Promise.resolve([])),
    spectate: vi.fn(() => Promise.resolve({ gameId: 'g', ticket: 't' })),
    history: vi.fn(() => Promise.resolve([{ role: 'player' }])),
  },
```

Add `getRoom` to the `mocked` type cast (lines 24-29):

```ts
const mocked = api as unknown as {
  getPublicRooms: ReturnType<typeof vi.fn>;
  getMyRooms: ReturnType<typeof vi.fn>;
  getRoom: ReturnType<typeof vi.fn>;
  spectate: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
};
```

Add `mocked.getRoom.mockResolvedValue(pubRoom('X', 'LOBBY'))` is NOT needed as a default — only
set it per-test, since the existing tests never exercise the code box. Add this new test inside
`describe('HomeScreen', ...)`, after the `'lists public rooms with Join (lobby) and Watch (live)
actions'` test:

```ts
  it('spectates via the code box when the code targets a started, spectatable room', async () => {
    mocked.getRoom.mockResolvedValue(pubRoom('LIVEEE', 'STARTED', 'g9'));
    render(<HomeScreen />);
    const input = await screen.findByLabelText('輸入房號');
    fireEvent.change(input, { target: { value: 'liveee' } });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => expect(mocked.getRoom).toHaveBeenCalledWith('LIVEEE'));
    await waitFor(() => expect(mocked.spectate).toHaveBeenCalledWith('LIVEEE'));
    expect(mocked.joinRoom).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: the new test FAILS — `mocked.getRoom` is never called because `join()` still calls
`api.joinRoom` directly.

- [ ] **Step 3: Implement the spectate fallback**

Open `apps/web/src/screens/HomeScreen.tsx`. Find the `join` handler (currently lines 166-176):

```ts
const join = async () => {
  setBusy(true);
  setErr(null);
  try {
    enterRoom((await api.joinRoom(code.trim().toUpperCase())).code);
  } catch (e) {
    setErr((e as Error).message);
  } finally {
    setBusy(false);
  }
};
```

Replace it with:

```ts
const join = async () => {
  setBusy(true);
  setErr(null);
  try {
    const target = code.trim().toUpperCase();
    const r = await api.getRoom(target);
    if (r.status === 'STARTED' && r.settings.allowSpectating) {
      const tk = await api.spectate(target);
      connectGame(tk.ticket);
      enterGame(tk.gameId, tk.ticket);
    } else {
      enterRoom((await api.joinRoom(target)).code);
    }
  } catch (e) {
    setErr((e as Error).message);
  } finally {
    setBusy(false);
  }
};
```

No new imports are needed: `connectGame` is already imported at `HomeScreen.tsx:7` and `enterGame`
is already destructured from `useUi` at `HomeScreen.tsx:62`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: PASS — all tests in `HomeScreen.test.tsx`, including the new one.

- [ ] **Step 5: Typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/HomeScreen.tsx apps/web/src/screens/HomeScreen.test.tsx
git commit -m "$(cat <<'EOF'
fix(web): spectate via the home-page code box for a started room

Entering the code for an already-started room always attempted a
full join and surfaced the server's raw "game already started"
error, even when the room allowed spectating.
EOF
)"
```

---

### Task 3: Full verification pass

**Files:** none (verification only)

**Interfaces:** none — this task only runs commands.

- [ ] **Step 1: Run the full web test suite**

Run: `yarn workspace @trm/web test`
Expected: all tests PASS (no regressions in other screens that import `HomeScreen`/`RoomScreen`
indirectly, e.g. any router-level test).

- [ ] **Step 2: Run the full web typecheck**

Run: `yarn workspace @trm/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `yarn workspace @trm/web lint`
Expected: no errors.

- [ ] **Step 4: Manual smoke test (dev server)**

Run (needs Mongo — `docker compose up -d mongo` first if not already running):
`yarn workspace @trm/server dev` and, in a second terminal, `yarn workspace @trm/web dev`.

In a browser:

1. Sign in as guest A, create a room, set visibility to "僅限邀請" (INVITE_ONLY), leave
   "允許觀戰" (allowSpectating) on, add a bot, ready up, start the game. Copy the room link.
2. Open the room link in a second (private/incognito) browser profile, sign in as guest B.
   Confirm B lands in the game as a spectator (no hand, board visible) instead of being bounced
   to the home page.
3. From guest B's home page, paste the same room code into the code box and click "加入"
   instead of using the link. Confirm the same spectate behavior (no "game already started"
   error).
4. Repeat steps 1-3 with "允許觀戰" turned off before starting. Confirm guest B is redirected
   to the home page in both the link-open and code-box cases, with no error message (existing,
   unchanged behavior).

- [ ] **Step 5: Commit (only if the smoke test surfaced fixes)**

If manual testing found no issues, there is nothing to commit for this task — Tasks 1 and 2
already committed the working implementation.

## Self-Review Notes

- **Spec coverage:** Task 1 covers the design spec's "direct room link" fix; Task 2 covers the
  "home-page join box" fix; both explicitly preserve the "spectating off → silent redirect home"
  behavior via a dedicated test case. Task 3 verifies no regressions and confirms the end-to-end
  behavior manually, since neither task's automated tests exercise a real WebSocket connection.
- **Placeholder scan:** none found — every step has runnable code and exact commands.
- **Type consistency:** `TicketResult`, `RoomView`, `RoomSettings.allowSpectating`, `api.spectate`,
  `api.getRoom`, `connectGame`, `enterGame` are used with the same names and shapes across both
  tasks and match their existing definitions in `apps/web/src/net/rest.ts`,
  `apps/web/src/net/connection.ts`, and `apps/web/src/store/ui.ts`.
