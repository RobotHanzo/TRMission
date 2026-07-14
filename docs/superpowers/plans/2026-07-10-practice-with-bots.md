# Practice with Bots — Welcome-Screen Option — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Practice with bots" option to the first-entry welcome screen that starts a game immediately (you + one easy bot + one medium bot, default rules) and lands the player straight on the game board.

**Architecture:** A new atomic server endpoint `POST /rooms/practice` composes the existing validated lobby service methods (`create` → `addBot` × 2 → `ready` → `start`) and returns the room code plus a ws-game ticket. The web client calls it in one request from a new welcome-screen card, then navigates with the same `enterRoom` → `enterGame` sequence `HomeScreen.watch()` already uses.

**Tech Stack:** NestJS + zod (`nestjs-zod`) + supertest/vitest on the server; React + Vite + react-i18next + zustand + `@testing-library/react` on the web.

## Global Constraints

- **Stay on `main`.** Do not switch branches.
- **Never `git add -A` / `git add .`.** Multiple agents share this worktree — stage only the files this plan changes. There are pre-existing unrelated `graphify-out/**` modifications in the working tree; leave them alone.
- **i18n is zh-Hant primary + en fallback.** Every new UI string is added to BOTH `zh-Hant` and `en` tables in `apps/web/src/i18n/index.ts`.
- **swc, not tsx** on the server — do not touch the runtime/test transform config.
- **Default rules/map are intentional.** Do not pass any settings overrides; the room's `DEFAULT_ROOM_SETTINGS` and default `maxPlayers` (5) are what "default rules" means.
- **Validation gates:** `yarn typecheck`, `yarn lint`, and `yarn format` (CI gate is `format:check`) must pass before each commit.

---

### Task 1: Server — atomic `POST /rooms/practice` endpoint

**Files:**

- Create: `apps/server/test/lobby-practice.e2e.spec.ts`
- Modify: `apps/server/src/lobby/lobby.schemas.ts` (add `PracticeResultSchema` after `TicketResultSchema`, ~line 76)
- Modify: `apps/server/src/lobby/lobby.service.ts` (add `PracticeResult` interface after `TicketResult`, ~line 49; add `startPractice` method after `start`, ~line 370)
- Modify: `apps/server/src/lobby/lobby.controller.ts` (import `PracticeResultSchema`; add `practice` route after `create`, ~line 39)

**Interfaces:**

- Consumes (existing `LobbyService` methods, unchanged): `create(user): Promise<RoomView>` (RoomView has `code: string`), `addBot(code, user, difficulty: BotDifficulty): Promise<RoomView>`, `ready(code, user, ready: boolean): Promise<RoomView>`, `start(code, user): Promise<TicketResult>` where `TicketResult = { gameId: string; ticket: string }`, and the private `assertNotDisabled(userId): Promise<void>`.
- Produces: `LobbyService.startPractice(user: AuthUser): Promise<PracticeResult>` where `PracticeResult = { gameId: string; ticket: string; code: string }`; HTTP `POST /api/v1/rooms/practice` returning that shape as JSON with status 200.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/server/test/lobby-practice.e2e.spec.ts`:

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

describe('lobby: practice with bots (one-call quick start)', () => {
  it('starts a game with one easy + one medium bot and returns code/gameId/ticket', async () => {
    const host = await guest('Practicer');

    const res = await request(server())
      .post('/api/v1/rooms/practice')
      .set(auth(host.token))
      .expect(200);
    expect(res.body.code).toBeTruthy();
    expect(res.body.gameId).toBeTruthy();
    expect(res.body.ticket).toBeTruthy();

    const room = await request(server())
      .get(`/api/v1/rooms/${res.body.code}`)
      .set(auth(host.token))
      .expect(200);
    expect(room.body.status).toBe('STARTED');
    expect(room.body.members).toHaveLength(3);

    const bots = room.body.members.filter((m: { isBot?: boolean }) => m.isBot);
    expect(bots.map((b: { difficulty: string }) => b.difficulty).sort()).toEqual([
      'EASY',
      'MEDIUM',
    ]);

    const humans = room.body.members.filter((m: { isBot?: boolean }) => !m.isBot);
    expect(humans).toHaveLength(1);
    expect(humans[0].userId).toBe(host.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @trm/server test --run lobby-practice`
Expected: FAIL — `POST /api/v1/rooms/practice` responds 404/400 (route not defined), so `.expect(200)` fails.

- [ ] **Step 3: Add the result schema**

In `apps/server/src/lobby/lobby.schemas.ts`, immediately after the `TicketResultSchema` line (`export const TicketResultSchema = z.object({ gameId: z.string(), ticket: z.string() });`), add:

```ts
export const PracticeResultSchema = TicketResultSchema.extend({ code: z.string() });
```

- [ ] **Step 4: Add the `PracticeResult` interface and `startPractice` method**

In `apps/server/src/lobby/lobby.service.ts`, right after the `TicketResult` interface (the block ending `}` at ~line 49), add:

```ts
export interface PracticeResult extends TicketResult {
  code: string;
}
```

Then, right after the `start(...)` method (after its closing `}` at ~line 370), add:

```ts
  /**
   * One-call quick start for the welcome screen's "practice with bots": create a room, seat one
   * EASY + one MEDIUM bot, mark the host ready, and start — all on the default map/rules. Returns
   * the ticket plus the room `code` (the client needs it for the /room/:code URL and reconnects).
   * Composes the existing host-only service methods, so all their validation still applies.
   */
  async startPractice(user: AuthUser): Promise<PracticeResult> {
    await this.assertNotDisabled(user.userId);
    const { code } = await this.create(user);
    await this.addBot(code, user, 'EASY');
    await this.addBot(code, user, 'MEDIUM');
    await this.ready(code, user, true);
    const ticket = await this.start(code, user);
    return { ...ticket, code };
  }
```

- [ ] **Step 5: Add the controller route**

In `apps/server/src/lobby/lobby.controller.ts`, add `PracticeResultSchema` to the existing import from `./lobby.schemas` (the block importing `TicketResultSchema`). Then add this route immediately after the `create(...)` handler (after its closing `}` at ~line 39), so the literal `practice` segment is registered before the `:code` routes:

```ts
  @Post('practice')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create a solo practice game (you + an easy + a medium bot) and start it',
  })
  @ApiResponse({ status: 200, schema: apiSchema(PracticeResultSchema) })
  practice(@CurrentUser() user: AuthUser) {
    return this.lobby.startPractice(user);
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn workspace @trm/server test --run lobby-practice`
Expected: PASS (1 test).

- [ ] **Step 7: Typecheck + lint the server**

Run: `yarn typecheck && yarn lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/test/lobby-practice.e2e.spec.ts apps/server/src/lobby/lobby.schemas.ts apps/server/src/lobby/lobby.service.ts apps/server/src/lobby/lobby.controller.ts
git commit -m "feat(server): POST /rooms/practice — one-call start vs easy+medium bots"
```

---

### Task 2: Web — welcome-screen "Practice with bots" card + navigation

**Files:**

- Modify: `apps/web/src/net/rest.ts` (add `PracticeResult` interface after `TicketResult`, ~line 90; add `startPractice` to the `api` object near `createRoom`/`startRoom`, ~line 342)
- Modify: `apps/web/src/i18n/index.ts` (add `practice*` keys under `home.welcome` in the zh-Hant table ~line 51 and the en table ~line 603)
- Modify: `apps/web/src/screens/WelcomeScreen.tsx` (new `onPractice` prop + practice card + local busy/error state)
- Modify: `apps/web/src/screens/HomeScreen.tsx` (add `startPractice` handler ~line 131; pass `onPractice` to `<WelcomeScreen>` ~line 137)
- Modify: `apps/web/src/styles/home.css` (`.welcome-options` `max-width`, ~line 327)
- Modify: `apps/web/src/screens/HomeScreen.test.tsx` (mock `startPractice`; add a test)

**Interfaces:**

- Consumes: `LobbyService`'s HTTP `POST /rooms/practice` returning `{ gameId, ticket, code }` (Task 1); existing web helpers `connectGame(ticket, { roomCode })`, `useUi().enterRoom(code)`, `useUi().enterGame(gameId, ticket)`.
- Produces: `api.startPractice(): Promise<PracticeResult>` where `PracticeResult = TicketResult & { code: string }`; `WelcomeScreen` prop `onPractice: () => Promise<void>`.

- [ ] **Step 1: Add the REST client type + method**

In `apps/web/src/net/rest.ts`, right after the `TicketResult` interface (the block ending `}` at ~line 90), add:

```ts
export interface PracticeResult extends TicketResult {
  code: string;
}
```

Then, inside the `api` object, right after the `startRoom` line (`startRoom: (code: string) => req<TicketResult>('POST', ...),` ~line 342), add:

```ts
  startPractice: () => req<PracticeResult>('POST', '/rooms/practice'),
```

- [ ] **Step 2: Write the failing web test**

In `apps/web/src/screens/HomeScreen.test.tsx`:

(a) Add `startPractice` to the `api` mock factory object (alongside `spectate`, ~line 20):

```ts
    startPractice: vi.fn(() => Promise.resolve({ code: 'PRAC01', gameId: 'gp', ticket: 'tp' })),
```

(b) Add `startPractice` to the `mocked` cast type (the `as unknown as {...}` block, ~line 25):

```ts
startPractice: ReturnType<typeof vi.fn>;
```

(c) Add this test at the end of the `describe('HomeScreen', ...)` block (after the last `it(...)`, ~line 167):

```ts
  it('starts a practice game with bots from the welcome screen', async () => {
    mocked.history.mockResolvedValue([]); // brand-new account → welcome screen shows
    render(<HomeScreen />);
    const practice = await screen.findByRole('button', { name: /開始練習/ });
    fireEvent.click(practice);
    await waitFor(() => expect(mocked.startPractice).toHaveBeenCalled());
    // Same navigation contract as watch(): roomCode + /room/:code URL, then the game view.
    await waitFor(() => expect(useUi.getState().roomCode).toBe('PRAC01'));
    await waitFor(() => expect(useUi.getState().gameId).toBe('gp'));
    expect(window.location.pathname).toBe('/room/PRAC01');
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: FAIL — the new test times out on `findByRole('button', { name: /開始練習/ })` (the card doesn't exist yet). Existing tests still pass.

- [ ] **Step 4: Add the i18n strings (both languages)**

In `apps/web/src/i18n/index.ts`, in the **zh-Hant** `home.welcome` object, insert after the `learnCta: '開始教學',` line (~line 51):

```ts
          practiceTitle: '和機器人練習',
          practiceDesc: '立即用預設規則開一局：一個簡單、一個普通機器人陪你練手。',
          practiceCta: '開始練習',
          practiceStarting: '準備中…',
          practiceError: '無法開始練習遊戲，請再試一次。',
```

In the **en** `home.welcome` object, insert after the `learnCta: 'Start tutorial',` line (~line 603):

```ts
          practiceTitle: 'Practice with bots',
          practiceDesc:
            'Jump straight into a game with default rules against one easy and one medium bot.',
          practiceCta: 'Start practising',
          practiceStarting: 'Starting…',
          practiceError: 'Could not start the practice game. Please try again.',
```

- [ ] **Step 5: Add the practice card to `WelcomeScreen`**

Replace the entire contents of `apps/web/src/screens/WelcomeScreen.tsx` with:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CirclePlay, GraduationCap } from 'lucide-react';
import { BrandBanner } from '../components/BrandBanner';

interface WelcomeScreenProps {
  name: string;
  onStartTutorial: () => void;
  onPractice: () => Promise<void>;
  onContinue: () => void;
}

/** First entry: shown instead of the homepage while an account has 0 completed games. */
export function WelcomeScreen({
  name,
  onStartTutorial,
  onPractice,
  onContinue,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <button className="welcome-option-cta" disabled={busy} onClick={() => void practice()}>
            {busy ? t('home.welcome.practiceStarting') : `${t('home.welcome.practiceCta')} →`}
          </button>
        </div>

        <div className="welcome-option">
          <div className="welcome-option-icon">
            <CirclePlay size={26} aria-hidden />
          </div>
          <h3>{t('home.welcome.skipTitle')}</h3>
          <p>{t('home.welcome.skipDesc')}</p>
          <button className="welcome-option-cta" onClick={onContinue}>
            {t('home.welcome.skipCta')} →
          </button>
        </div>
      </div>

      {error && <p className="welcome-error error">{error}</p>}
      <p className="welcome-footnote muted">{t('home.welcome.footnote')}</p>
    </div>
  );
}
```

- [ ] **Step 6: Wire the handler in `HomeScreen`**

In `apps/web/src/screens/HomeScreen.tsx`, add the handler just before the `if (showWelcome) {` block (after `if (showWelcome === null) return null;`, ~line 131). It intentionally does NOT catch — it re-throws so `WelcomeScreen` surfaces the error:

```tsx
// Welcome-screen "practice with bots": one server call spins up a started game vs bots, then we
// navigate exactly like watch() does (roomCode + /room/:code URL before entering the game view).
const startPractice = async () => {
  const tk = await api.startPractice();
  connectGame(tk.ticket, { roomCode: tk.code });
  enterRoom(tk.code);
  enterGame(tk.gameId, tk.ticket);
};
```

Then pass it to `<WelcomeScreen>` (the JSX at ~line 133-138):

```tsx
return (
  <WelcomeScreen
    name={user.displayName}
    onStartTutorial={enterTutorial}
    onPractice={startPractice}
    onContinue={() => setShowWelcome(false)}
  />
);
```

(`enterRoom`, `enterGame`, `connectGame`, and `api` are already imported/destructured at the top of this file — no new imports.)

- [ ] **Step 7: Widen the welcome-options row for three cards**

In `apps/web/src/styles/home.css`, in the `.welcome-options` rule (~line 323-328), change the max-width from `720px` to `1040px`:

```css
.welcome-options {
  display: flex;
  gap: var(--tr-space-6);
  width: 100%;
  max-width: 1040px;
}
```

(The existing `@media (max-width: 700px)` rule already sets `.welcome-options { flex-direction: column; }`, so mobile stacking is unchanged.)

- [ ] **Step 8: Run the web test to verify it passes**

Run: `yarn workspace @trm/web test --run HomeScreen`
Expected: PASS — the new test plus all existing HomeScreen tests are green.

- [ ] **Step 9: Typecheck + lint + format**

Run: `yarn typecheck && yarn lint && yarn format`
Expected: no errors; formatting clean.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/net/rest.ts apps/web/src/i18n/index.ts apps/web/src/screens/WelcomeScreen.tsx apps/web/src/screens/HomeScreen.tsx apps/web/src/styles/home.css apps/web/src/screens/HomeScreen.test.tsx
git commit -m "feat(web): add \"practice with bots\" option to the welcome screen"
```

---

### Task 3: Full-suite verification

**Files:** none (validation only).

- [ ] **Step 1: Run the full test suite, typecheck, lint, and format check**

Run: `yarn test && yarn typecheck && yarn lint && yarn format:check`
Expected: all workspaces green; no type, lint, or formatting errors.

- [ ] **Step 2: Manual smoke (optional but recommended)**

With Mongo up (`docker compose up -d mongo`), run `yarn workspace @trm/server dev` and `yarn workspace @trm/web dev`, sign in as a fresh guest (0 completed games) so the welcome screen shows, click **和機器人練習 / Practice with bots**, and confirm you land on the game board with two bot seats (one easy, one medium) already in play.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Expected: graph refreshes (AST-only, no API cost).

---

## Self-Review

**Spec coverage:**

- Server `startPractice` service method → Task 1, Step 4. ✓
- `POST /rooms/practice` route → Task 1, Step 5. ✓
- `PracticeResultSchema` (code + ticket) → Task 1, Step 3. ✓
- `api.startPractice()` → Task 2, Step 1. ✓
- WelcomeScreen third card + busy/error → Task 2, Step 5. ✓
- HomeScreen handler mirroring `watch()` navigation → Task 2, Step 6. ✓
- i18n keys in zh-Hant + en → Task 2, Step 4. ✓
- CSS `.welcome-options` widen → Task 2, Step 7. ✓
- Server e2e test (STARTED room, 1 human + EASY/MEDIUM bots) → Task 1, Step 1. ✓
- Web test (option renders, click → startPractice + navigate) → Task 2, Step 2. ✓
- Out of scope (configurable difficulty/counts, other entry points, rule changes) → none added. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps; every code step shows complete code. ✓

**Type consistency:** `PracticeResult = { gameId, ticket, code }` is identical server-side (Task 1, Step 4) and web-side (Task 2, Step 1). `startPractice` is the method name on both `LobbyService` and `api`. `onPractice: () => Promise<void>` matches between `WelcomeScreen`'s prop (Task 2, Step 5) and `HomeScreen`'s `startPractice` handler (Task 2, Step 6). Mock return `{ code:'PRAC01', gameId:'gp', ticket:'tp' }` matches the fields the handler reads (`tk.ticket`, `tk.code`, `tk.gameId`). ✓
