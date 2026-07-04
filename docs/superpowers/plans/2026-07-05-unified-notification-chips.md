# Unified Notification Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two unrelated transient-notification systems in `apps/web` (the bottom-center
single `<Toast>` pill and the top-center `EventToasts` stack) with one unified store slice and one
rendering component, so event notifications (e.g. "集章 +1") and system messages (errors, nudges,
"copied") all render as chips in the same top-center popup stack.

**Architecture:** Generalize the existing `eventToasts` slice of `store/animations.ts` (already
correctly isolated per game instance via `AnimationsStoreProvider`, so the encyclopedia sandbox and
replay screen never leak chips into/from a live game) into a `notifications` slice carrying a
discriminated union (`announced`/`bonus` event cues, `error`/`notice`/`success` system cues). A new
`components/NotificationStack.tsx` renders all of them; `components/Toast.tsx` and the old
`.event-toast*`/`.toast*` CSS are retired once every call site has migrated.

**Tech Stack:** React + TypeScript, Zustand, react-i18next, vitest + @testing-library/react.

## Global Constraints

- No new i18n strings — every notification's text is already fully resolved by existing i18n keys
  at its call site (`copied`, `insufficientCards`, `insufficientLocos`, `noStationsLeft`,
  `actionRejected`, `errors.*` event-rejection keys, `log.eventAnnounced`, `log.eventBonus.*`).
- No behavior change to *which* events produce a chip or to the chat-rejection filter
  (`isChatRejectionKey`) — only how/where chips render.
- Auto-dismiss durations must exactly match today's: error 3000ms, notice 3500ms, success 2000ms,
  announced/bonus 3400ms (see the `HOLD_MS` map in Task 1).
- `yarn workspace @trm/web test`, `yarn lint`, and `yarn typecheck` must pass before every commit —
  each task below must leave the workspace in a fully green state (no task depends on a later task
  to compile).
- Sandbox/replay isolation must be preserved: `NotificationStack` reads the same
  `useAnimationsStore` hook the rest of the animations UI already uses, so it automatically resolves
  to the contextual isolated store under `AnimationsStoreProvider`, or the live singleton otherwise.

---

### Task 1: Generalize the store slice + build the unified `NotificationStack` component

**Files:**
- Modify: `apps/web/src/store/animations.ts`
- Modify: `apps/web/src/hooks/useAnimationDriver.ts`
- Modify: `apps/web/src/components/EventBanner.tsx`
- Modify: `apps/web/src/components/AnimationLayer.tsx`
- Modify: `apps/web/src/styles/game.css`
- Create: `apps/web/src/components/NotificationStack.tsx`
- Test: `apps/web/src/store/animations.test.ts`
- Test: `apps/web/src/components/NotificationStack.test.tsx` (create)

**Interfaces:**
- Produces (used by Tasks 2 & 3): `pushNotification(cue: DistributiveOmit<NotificationCue, 'id'>): void`
  and `removeNotification(id: number): void` on the `useAnimations`/`useAnimationsStore` API, plus
  the exported `<NotificationStack />` component (no props).
- `NotificationCue` variants Tasks 2 & 3 will push: `{ variant: 'error' | 'notice' | 'success', text: string }`.

This task does **not** touch `GameStage.tsx` or `RoomScreen.tsx` — `components/Toast.tsx` keeps
working for them unchanged. Only the event-announcement/bonus chips move to the new plumbing, under
new names, with identical visible behavior. This is verified by the tests below plus manual
confirmation that nothing else in the app currently imports `EventToastCue`/`pushEventToast`/
`removeEventToast`/`EventToasts` (already checked — only `EventBanner.tsx`, `AnimationLayer.tsx`,
and `useAnimationDriver.ts` reference them).

- [ ] **Step 1: Write the failing store tests**

Append these two tests inside the existing `describe('animations store', ...)` block in
`apps/web/src/store/animations.test.ts` (right after the `'reset clears everything'` test, before
the closing `});`):

```ts
  it('pushNotification adds an event cue; removeNotification removes it by id', () => {
    useAnimations.getState().pushNotification({
      variant: 'bonus',
      kind: 'STAMP_RALLY',
      reason: 'STAMP',
      points: 1,
      cityId: 'taipei',
      routeId: '',
    });
    const cue = useAnimations.getState().notifications[0]!;
    expect(cue.variant).toBe('bonus');
    useAnimations.getState().removeNotification(cue.id);
    expect(useAnimations.getState().notifications).toHaveLength(0);
  });

  it('pushNotification adds a plain system cue carrying pre-resolved text', () => {
    useAnimations.getState().pushNotification({ variant: 'success', text: '已複製' });
    const cue = useAnimations.getState().notifications[0]!;
    expect(cue.variant).toBe('success');
    expect(cue).toMatchObject({ text: '已複製' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @trm/web test --run store/animations`
Expected: FAIL — `useAnimations.getState().pushNotification is not a function` (the method doesn't
exist yet; the store still only has `pushEventToast`).

- [ ] **Step 3: Rename and generalize the store slice**

In `apps/web/src/store/animations.ts`, replace the `EventToastCue` interface (currently lines
65–76) with:

```ts
/** Distributes Omit over a union so each member keeps only its own fields, instead of collapsing
 *  to the union's common keys (the built-in Omit is not distributive). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** A single transient notification chip. Two shapes: an event cue (forecast announcement or a
 *  claim bonus) whose copy + city/route names resolve at render (so late roster/locale changes
 *  apply), or a plain system message whose text is already fully resolved by the caller. */
export type NotificationCue =
  | {
      id: number;
      variant: 'announced' | 'bonus';
      kind: string;
      /** EVENT_BONUS reason ("HOTSPOT"|"REOPEN"|"STAMP"|"CHARTER"|"FREE_STATION"); "" for announcements. */
      reason: string;
      points: number;
      cityId: string;
      routeId: string;
    }
  | {
      id: number;
      variant: 'error' | 'notice' | 'success';
      text: string;
    };
```

Then, in the `AnimState` interface, replace:

```ts
  /** Live random-event toasts (forecast announcements + claim bonuses); each self-expires. */
  eventToasts: EventToastCue[];
```

with:

```ts
  /** Live notification chips (system messages + random-event announcements/bonuses); each
   *  self-expires. */
  notifications: NotificationCue[];
```

and replace:

```ts
  pushEventToast(cue: Omit<EventToastCue, 'id'>): void;
  removeEventToast(id: number): void;
```

with:

```ts
  pushNotification(cue: DistributiveOmit<NotificationCue, 'id'>): void;
  removeNotification(id: number): void;
```

In the `initial()` factory, replace:

```ts
  eventToasts: [] as EventToastCue[],
```

with:

```ts
  notifications: [] as NotificationCue[],
```

In the `creator`, replace:

```ts
  pushEventToast: (cue) =>
    set((s) => ({ eventToasts: [...s.eventToasts, { id: nextId(), ...cue }] })),
  removeEventToast: (id) =>
    set((s) => ({ eventToasts: s.eventToasts.filter((c) => c.id !== id) })),
```

with:

```ts
  pushNotification: (cue) =>
    set((s) => ({
      notifications: [...s.notifications, { id: nextId(), ...cue } as NotificationCue],
    })),
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((c) => c.id !== id) })),
```

- [ ] **Step 4: Run the store tests to verify they pass**

Run: `yarn workspace @trm/web test --run store/animations`
Expected: all tests PASS (the two new ones plus every pre-existing one, unaffected by the rename).

- [ ] **Step 5: Write the failing `NotificationStack` component test**

Create `apps/web/src/components/NotificationStack.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '../i18n';
import { useAnimations } from '../store/animations';
import { NotificationStack } from './NotificationStack';

describe('NotificationStack', () => {
  beforeEach(() => {
    useAnimations.getState().reset();
  });

  it('renders nothing when there are no notifications', () => {
    const { container } = render(<NotificationStack />);
    expect(container.firstChild).toBeNull();
  });

  it('renders resolved copy for an event bonus cue (e.g. a stamp-rally +1)', () => {
    useAnimations.getState().pushNotification({
      variant: 'bonus',
      kind: 'STAMP_RALLY',
      reason: 'STAMP',
      points: 1,
      cityId: 'taipei',
      routeId: '',
    });
    render(<NotificationStack />);
    expect(screen.getByText('集章 +1（臺北）')).toBeInTheDocument();
  });

  it('renders resolved copy for an announced (forecast) cue', () => {
    useAnimations.getState().pushNotification({
      variant: 'announced',
      kind: 'SKY_LANTERN',
      reason: '',
      points: 0,
      cityId: '',
      routeId: '',
    });
    render(<NotificationStack />);
    expect(screen.getByText('預報：天燈之夜 即將來臨')).toBeInTheDocument();
  });

  it('renders a plain system cue verbatim, with its variant class', () => {
    useAnimations.getState().pushNotification({ variant: 'error', text: '動作被拒絕' });
    render(<NotificationStack />);
    const chip = screen.getByText('動作被拒絕');
    expect(chip).toHaveClass('notification-chip--error');
  });

  it('stacks multiple concurrent notifications in push order', () => {
    useAnimations.getState().pushNotification({ variant: 'success', text: '已複製' });
    useAnimations.getState().pushNotification({ variant: 'notice', text: '車廂卡不足' });
    render(<NotificationStack />);
    const chips = screen.getAllByRole('status');
    expect(chips.map((c) => c.textContent)).toEqual(['已複製', '車廂卡不足']);
  });

  it('auto-dismisses a cue after its variant hold time, then removes it after the exit fade', () => {
    vi.useFakeTimers();
    try {
      useAnimations.getState().pushNotification({ variant: 'success', text: '已複製' });
      render(<NotificationStack />);
      expect(screen.getByText('已複製')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000); // success HOLD_MS
      });
      expect(screen.getByText('已複製')).toHaveClass('notification-chip--exit');

      act(() => {
        vi.advanceTimersByTime(200); // EXIT_MS
      });
      expect(screen.queryByText('已複製')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `yarn workspace @trm/web test --run NotificationStack`
Expected: FAIL — `Cannot find module './NotificationStack'` (the component doesn't exist yet).

- [ ] **Step 7: Create `NotificationStack.tsx`**

Create `apps/web/src/components/NotificationStack.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimationsStore, type NotificationCue } from '../store/animations';
import { useUi } from '../store/ui';
import { cityName, routeById } from '../game/content';
import { eventNameKey } from '../game/events';

// Must stay >= the tr-toast-out duration in game.css so the exit animation finishes before the
// chip unmounts. Under prefers-reduced-motion the animation is disabled, so the chip simply
// lingers (invisible work, no flash) for this window then unmounts.
const EXIT_MS = 200;

// How long each variant stays fully visible before it starts fading out — matches the durations
// the two prior systems (Toast.tsx / the old EventToastRow) used, so timing doesn't regress.
const HOLD_MS: Record<NotificationCue['variant'], number> = {
  error: 3000,
  notice: 3500,
  success: 2000,
  announced: 3400,
  bonus: 3400,
};

function NotificationChip({ cue }: { cue: NotificationCue }) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const removeNotification = useAnimationsStore((s) => s.removeNotification);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const holdId = window.setTimeout(() => setExiting(true), HOLD_MS[cue.variant]);
    return () => clearTimeout(holdId);
  }, [cue.variant]);

  useEffect(() => {
    if (!exiting) return;
    const exitId = window.setTimeout(() => removeNotification(cue.id), EXIT_MS);
    return () => clearTimeout(exitId);
  }, [exiting, cue.id, removeNotification]);

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const text =
    cue.variant === 'announced'
      ? t('log.eventAnnounced', { event: t(eventNameKey(cue.kind)) })
      : cue.variant === 'bonus'
        ? t(`log.eventBonus.${cue.reason}`, {
            points: cue.points,
            city: cue.cityId ? cityName(cue.cityId, locale) : '',
            route: cue.routeId ? routeName(cue.routeId) : '',
          })
        : cue.text;

  const cls = [
    'notification-chip',
    `notification-chip--${cue.variant}`,
    exiting && 'notification-chip--exit',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} role="status">
      {text}
    </div>
  );
}

/** The stacked, self-expiring notification chips — system messages (errors, nudges, confirmations)
 *  and random-event announcements/bonuses — rendered above the board. */
export function NotificationStack() {
  const notifications = useAnimationsStore((s) => s.notifications);
  if (notifications.length === 0) return null;
  return (
    <div className="notification-stack">
      {notifications.map((c) => (
        <NotificationChip key={c.id} cue={c} />
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Trim `EventBanner.tsx` down to just the start banner**

Replace the full contents of `apps/web/src/components/EventBanner.tsx` with:

```tsx
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type EventBannerCue } from '../store/animations';
import { eventDescKey, eventNameKey } from '../game/events';

interface Props {
  cue: EventBannerCue;
  reducedMotion: boolean;
  onDone(): void;
}

/**
 * The random-event START banner: a prominent but skippable card announcing a newly-live event.
 * Modelled on {@link EndgameWarning} — dismissible by click / Escape / auto-timeout and
 * reduced-motion aware. All copy resolves from the event `kind` at render.
 */
export function EventBanner({ cue, reducedMotion, onDone }: Props) {
  const { t } = useTranslation();

  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(finish, reducedMotion ? 1800 : 3400);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [reducedMotion, finish]);

  return (
    <div className="event-backdrop" onClick={finish}>
      <div className="event-banner-panel" role="alert">
        <div className="event-eyebrow">{t('events.eyebrow')}</div>
        <div className="event-banner-title">{t(eventNameKey(cue.kind))}</div>
        <div className="event-banner-desc">{t(eventDescKey(cue.kind))}</div>
        <div className="event-skip">{t('skip')}</div>
      </div>
    </div>
  );
}
```

(This deletes `EventToastRow` and `EventToasts` from this file — they now live in
`NotificationStack.tsx`.)

- [ ] **Step 9: Point `AnimationLayer.tsx` at the new component**

In `apps/web/src/components/AnimationLayer.tsx`, replace:

```ts
import { EventBanner, EventToasts } from './EventBanner';
```

with:

```ts
import { EventBanner } from './EventBanner';
import { NotificationStack } from './NotificationStack';
```

and replace the last line of the portal's JSX:

```tsx
      <EventToasts />
```

with:

```tsx
      <NotificationStack />
```

- [ ] **Step 10: Rename the push calls in `useAnimationDriver.ts`**

In `apps/web/src/hooks/useAnimationDriver.ts`, replace:

```ts
  const pushEventToast = useAnimationsStore((s) => s.pushEventToast);
```

with:

```ts
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
```

Replace the two call sites:

```ts
      } else if (ev.case === 'randomEventAnnounced') {
        if (ev.value.info)
          pushEventToast({
            variant: 'announced',
            kind: ev.value.info.kind,
            reason: '',
            points: 0,
            cityId: '',
            routeId: '',
          });
      } else if (ev.case === 'randomEventBonus') {
        pushEventToast({
          variant: 'bonus',
          kind: ev.value.kind,
          reason: ev.value.reason,
          points: ev.value.points,
          cityId: ev.value.cityId,
          routeId: ev.value.routeId,
        });
      }
```

with:

```ts
      } else if (ev.case === 'randomEventAnnounced') {
        if (ev.value.info)
          pushNotification({
            variant: 'announced',
            kind: ev.value.info.kind,
            reason: '',
            points: 0,
            cityId: '',
            routeId: '',
          });
      } else if (ev.case === 'randomEventBonus') {
        pushNotification({
          variant: 'bonus',
          kind: ev.value.kind,
          reason: ev.value.reason,
          points: ev.value.points,
          cityId: ev.value.cityId,
          routeId: ev.value.routeId,
        });
      }
```

And update the effect's dependency array — replace:

```ts
  }, [lastBatch, pushIntent, gameStore, showEventBanner, pushEventToast]);
```

with:

```ts
  }, [lastBatch, pushIntent, gameStore, showEventBanner, pushNotification]);
```

- [ ] **Step 11: Rename and extend the CSS**

In `apps/web/src/styles/game.css`, replace the `/* ─── Event toasts ... ─── */` section (the
block starting `.event-toast-stack {` through the `@media (prefers-reduced-motion: reduce)` block
that ends it — currently the last block in the file, lines 1780–1815) with:

```css
/* ─── Notification chips (system messages + event announcements/bonuses) ───────── */
.notification-stack {
  position: fixed;
  top: var(--tr-space-6);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--tr-space-2);
  z-index: 61;
  pointer-events: none;
}
.notification-chip {
  padding: var(--tr-space-2) var(--tr-space-4);
  border-radius: 999px;
  background: var(--tr-ink);
  color: var(--tr-surface);
  box-shadow: var(--tr-shadow);
  font-size: 13px;
  font-weight: 600;
  animation: tr-toast-in 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* Reverse of the entrance, held on its end frame (forwards) until the chip unmounts. */
.notification-chip.notification-chip--exit {
  animation: tr-toast-out 200ms ease-in forwards;
}
/* Plain vertical slide — every chip is a flex child of .notification-stack, which handles
   horizontal centering, so (unlike the old bottom-fixed .toast) no translateX(-50%) is needed. */
@keyframes tr-toast-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes tr-toast-out {
  from {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  to {
    opacity: 0;
    transform: translateY(10px) scale(0.96);
  }
}
.notification-chip--error {
  background: var(--tr-danger);
  color: #fff;
}
.notification-chip--notice {
  background: var(--tr-blue);
  color: #fff;
}
.notification-chip--success {
  background: var(--tr-ok);
  color: #fff;
}
.notification-chip--announced {
  background: var(--tr-accent);
  color: #fff;
}
.notification-chip--bonus {
  background: var(--tr-ok);
  color: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .notification-chip,
  .notification-chip.notification-chip--exit {
    animation: none;
  }
}
```

Leave the standalone `.toast` / `.toast-notice` / `.toast-success` block (currently lines
1472–1529) and the `.game--dock .toast` overrides (currently lines 1644–1651) **untouched** for
now — `components/Toast.tsx` still renders them for `GameStage.tsx` and `RoomScreen.tsx` until
Tasks 2 and 3 migrate those call sites. They are deleted in Task 4.

- [ ] **Step 12: Run the full check**

Run: `yarn workspace @trm/web test --run` then `yarn lint` then `yarn typecheck`
Expected: all green. In particular, `NotificationStack.test.tsx` and `store/animations.test.ts`
pass, and no other test broke (nothing else referenced the renamed symbols).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/store/animations.ts apps/web/src/store/animations.test.ts \
  apps/web/src/hooks/useAnimationDriver.ts apps/web/src/components/EventBanner.tsx \
  apps/web/src/components/AnimationLayer.tsx apps/web/src/components/NotificationStack.tsx \
  apps/web/src/components/NotificationStack.test.tsx apps/web/src/styles/game.css
git commit -m "$(cat <<'EOF'
refactor(web): generalize event toasts into a unified notification store

Renames the animations store's eventToasts slice to a variant-typed
notifications slice and extracts NotificationStack out of EventBanner
so the same chip stack can carry system messages next. No visible
change yet — GameStage/RoomScreen still render via the old Toast.
EOF
)"
```

---

### Task 2: Migrate `GameStage.tsx` off `<Toast>` onto the unified stack

**Files:**
- Modify: `apps/web/src/screens/GameStage.tsx`

**Interfaces:**
- Consumes: `useAnimationsStore((s) => s.pushNotification)` from Task 1, with cues shaped
  `{ variant: 'notice' | 'error', text: string }`.

- [ ] **Step 1: Remove the local `notice` state and its dismiss effect**

In `apps/web/src/screens/GameStage.tsx`, replace the import:

```ts
import { useGameStore } from '../store/game';
```

with:

```ts
import { useGameStore, type RejectionInfo } from '../store/game';
```

Replace:

```ts
import { AnimationLayer } from '../components/AnimationLayer';
import { Toast } from '../components/Toast';
```

with:

```ts
import { AnimationLayer } from '../components/AnimationLayer';
import { useAnimationsStore } from '../store/animations';
```

Replace:

```ts
  // Client-side nudge (e.g. "not enough cards") shown when a click can't open a modal.
  const [notice, setNotice] = useState<string | null>(null);
```

with:

```ts
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
  // Tracks the last rejection object already turned into a chip, so the push effect below can
  // list its true dependencies (rejection, pushNotification, t) without re-pushing the same
  // rejection when pushNotification/t merely change identity (e.g. a locale switch).
  const pushedRejectionRef = useRef<RejectionInfo | null>(null);
```

Add `useRef` to the existing React import — replace:

```ts
import { useEffect, useState, type ReactNode } from 'react';
```

with:

```ts
import { useEffect, useRef, useState, type ReactNode } from 'react';
```

Replace:

```ts
  useEffect(() => {
    if (!rejection) return;
    const id = setTimeout(() => setRejection(null), 3000);
    return () => clearTimeout(id);
  }, [rejection, setRejection]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(id);
  }, [notice]);
```

with:

```ts
  useEffect(() => {
    if (!rejection) return;
    const id = setTimeout(() => setRejection(null), 3000);
    return () => clearTimeout(id);
  }, [rejection, setRejection]);
  useEffect(() => {
    if (!rejection || rejection === pushedRejectionRef.current) return;
    pushedRejectionRef.current = rejection;
    if (isChatRejectionKey(rejection.messageKey)) return;
    pushNotification({
      variant: 'error',
      text: t(eventRejectionHintKey(rejection.messageKey) ?? 'actionRejected'),
    });
  }, [rejection, pushNotification, t]);
```

- [ ] **Step 2: Route the three client-side nudges through `pushNotification`**

Replace:

```ts
    const s = routeShortfall(hand, route, extra);
    setNotice(
      s.kind === 'locos'
        ? t('insufficientLocos', { need: s.need, have: s.have })
        : t('insufficientCards', { need: s.need, have: s.have }),
    );
```

with:

```ts
    const s = routeShortfall(hand, route, extra);
    pushNotification({
      variant: 'notice',
      text:
        s.kind === 'locos'
          ? t('insufficientLocos', { need: s.need, have: s.have })
          : t('insufficientCards', { need: s.need, have: s.have }),
    });
```

Replace:

```ts
    const remaining = myPub?.stationsRemaining ?? 0;
    if (remaining <= 0) {
      setNotice(t('noStationsLeft'));
      return;
    }
```

with:

```ts
    const remaining = myPub?.stationsRemaining ?? 0;
    if (remaining <= 0) {
      pushNotification({ variant: 'notice', text: t('noStationsLeft') });
      return;
    }
```

Replace:

```ts
    const s = stationShortfall(hand, cost);
    setNotice(t('insufficientCards', { need: s.need, have: s.have }));
```

with:

```ts
    const s = stationShortfall(hand, cost);
    pushNotification({
      variant: 'notice',
      text: t('insufficientCards', { need: s.need, have: s.have }),
    });
```

- [ ] **Step 3: Remove the `<Toast>` JSX**

Replace:

```tsx
      <Toast message={notice} variant="toast-notice" />
      <Toast
        message={
          rejection && !isChatRejectionKey(rejection.messageKey)
            ? t(eventRejectionHintKey(rejection.messageKey) ?? 'actionRejected')
            : null
        }
      />
      <AnimationLayer />
```

with:

```tsx
      <AnimationLayer />
```

- [ ] **Step 4: Run the web test suite**

Run: `yarn workspace @trm/web test --run`
Expected: all tests PASS — no existing `GameStage` test asserted on `.toast`/`notice`/`rejection`
text directly (checked: `GameStage.dock.test.tsx`, `GameStage.gate.test.tsx`, `GameScreen.test.tsx`
only ever seed `rejection: null`), so none should break.

- [ ] **Step 5: Lint and typecheck**

Run: `yarn lint` and `yarn typecheck`
Expected: both exit 0. (`isChatRejectionKey` and `eventRejectionHintKey` stay imported and used;
`Toast` import removed; `useState`'s `notice` usage fully gone — confirm no unused-import lint
errors.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/GameStage.tsx
git commit -m "$(cat <<'EOF'
refactor(web): migrate GameStage notices/rejections to the notification stack

Both the client-side "insufficient cards" nudge and the action-
rejection message now push into the same chip stack event bonuses use,
instead of a separate bottom-center Toast.
EOF
)"
```

---

### Task 3: Migrate `RoomScreen.tsx` off `<Toast>` onto the unified stack

**Files:**
- Modify: `apps/web/src/screens/RoomScreen.tsx`

**Interfaces:**
- Consumes: `useAnimationsStore((s) => s.pushNotification)` from Task 1, `{ variant: 'success', text }`.
- Consumes: `NotificationStack` from Task 1 (`apps/web/src/components/NotificationStack.tsx`).

- [ ] **Step 1: Remove the local toast state and mount the shared stack**

In `apps/web/src/screens/RoomScreen.tsx`, replace:

```ts
import { useEffect, useRef, useState } from 'react';
```

with:

```ts
import { useEffect, useState } from 'react';
```

(`useRef` is only used today for the toast timer being removed in this step — confirm no other
`useRef` call remains in the file before dropping it from this import.)

Replace:

```ts
import { Toast } from '../components/Toast';
```

with:

```ts
import { useAnimationsStore } from '../store/animations';
import { NotificationStack } from '../components/NotificationStack';
```

Replace:

```ts
  const [kicked, setKicked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [myMaps, setMyMaps] = useState<MapSummary[] | null>(null);
```

with:

```ts
  const [kicked, setKicked] = useState(false);
  const [myMaps, setMyMaps] = useState<MapSummary[] | null>(null);
```

Replace:

```ts
  const [eventsFlag, setEventsFlag] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {
```

with:

```ts
  const [eventsFlag, setEventsFlag] = useState(false);
  const pushNotification = useAnimationsStore((s) => s.pushNotification);
  const {
```

Replace:

```ts
  const flashToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

```

with nothing (delete these 6 lines entirely — `pushNotification` cues self-expire on their own, no
local timer/state needed).

- [ ] **Step 2: Call `pushNotification` where `flashToast` was used**

Replace:

```ts
    void Promise.resolve(navigator.clipboard.writeText(text)).then(
      () => flashToast(t('copied')),
      () => undefined,
    );
```

with:

```ts
    void Promise.resolve(navigator.clipboard.writeText(text)).then(
      () => pushNotification({ variant: 'success', text: t('copied') }),
      () => undefined,
    );
```

- [ ] **Step 3: Swap the rendered component**

Replace:

```tsx
      <Toast message={toast} variant="toast-success" />
```

with:

```tsx
      <NotificationStack />
```

- [ ] **Step 4: Run the RoomScreen tests**

Run: `yarn workspace @trm/web test --run RoomScreen`
Expected: all PASS, including the existing `'flashes a success toast once the copy resolves'` test
(it only asserts on the text `'已複製'` via `screen.findByText`, which still appears — now inside a
`.notification-chip--success` instead of `.toast.toast-success`).

- [ ] **Step 5: Lint and typecheck**

Run: `yarn lint` and `yarn typecheck`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/screens/RoomScreen.tsx
git commit -m "$(cat <<'EOF'
refactor(web): migrate RoomScreen's copy confirmation to the notification stack

Drops the room screen's local toast timer/state in favor of the same
pushNotification + NotificationStack the game screen now uses.
EOF
)"
```

---

### Task 4: Delete `Toast.tsx` and the now-unused CSS

**Files:**
- Delete: `apps/web/src/components/Toast.tsx`
- Modify: `apps/web/src/styles/game.css`

Nothing imports `components/Toast.tsx` anymore after Tasks 2 and 3 — confirm with a search before
deleting.

- [ ] **Step 1: Confirm there are no remaining references**

Run (PowerShell): `Select-String -Path apps/web/src/**/*.tsx -Pattern "from '.*components/Toast'" -SimpleMatch:$false`
Expected: no matches (or run the equivalent `grep -rn "components/Toast" apps/web/src` — either
way, zero hits).

- [ ] **Step 2: Delete the component file**

Delete `apps/web/src/components/Toast.tsx`.

- [ ] **Step 3: Delete the now-unused CSS**

In `apps/web/src/styles/game.css`, delete the standalone toast block (currently lines 1472–1529):

```css
.toast {
  position: fixed;
  bottom: var(--tr-space-6);
  left: 50%;
  transform: translateX(-50%);
  background: var(--tr-danger);
  color: #fff;
  padding: var(--tr-space-2) var(--tr-space-4);
  border-radius: 999px;
  z-index: 60;
  box-shadow: var(--tr-shadow);
  /* Slide up + fade in on mount. The keyframe ends on translateX(-50%) to match the
     resting transform so there is no jump once it finishes. The <Toast> wrapper keeps
     the element mounted and adds .toast-exit to play tr-toast-out before it unmounts. */
  animation: tr-toast-in 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* Reverse of the entrance, held on its end frame (forwards) until <Toast> unmounts. */
.toast.toast-exit {
  animation: tr-toast-out 200ms ease-in forwards;
}
@keyframes tr-toast-in {
  from {
    opacity: 0;
    transform: translate(-50%, 14px) scale(0.94);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
}
@keyframes tr-toast-out {
  from {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
  to {
    opacity: 0;
    transform: translate(-50%, 10px) scale(0.96);
  }
}
/* Informational nudge (e.g. "not enough cards"): EMU-blue, lifted clear of the red
   rejection toast so the two never overlap if both happen to show. */
.toast.toast-notice {
  background: var(--tr-blue);
  bottom: calc(var(--tr-space-6) + 48px);
}
/* Confirmation (e.g. "copied"): green, so it reads as a success rather than a warning. */
.toast.toast-success {
  background: var(--tr-ok);
}
/* Placed after the .toast animation rules so it wins on source order (equal specificity
   for .toast, and matching specificity for .toast.toast-exit). */
@media (prefers-reduced-motion: reduce) {
  .toast,
  .toast.toast-exit {
    animation: none;
  }
}

```

(Leave the blank line and the following `/* Spectator banner ... */` section untouched — only the
block above is removed. Note `tr-toast-in`/`tr-toast-out` are already redefined in the
"Notification chips" section from Task 1, so removing this duplicate pair is safe.)

Then delete the dock override block (currently lines 1644–1651):

```css
  /* Toasts clear the dock instead of covering the tab bar (fixed-position, but they render
     inside .game so they inherit --tr-dock-h). */
  .game--dock .toast {
    bottom: calc(var(--tr-dock-h, 0px) + 72px);
  }
  .game--dock .toast.toast-notice {
    bottom: calc(var(--tr-dock-h, 0px) + 120px);
  }
```

(Leave the surrounding `.dock-panel .hand { ... }` rule above it and the
`/* Multi-card payment rows ... */` rule below it untouched — the `.notification-stack` sits at the
top of the viewport, so it needs no dock-height offset.)

- [ ] **Step 4: Run the full check**

Run: `yarn workspace @trm/web test --run` then `yarn lint` then `yarn typecheck`
Expected: all green.

- [ ] **Step 5: Manual smoke check**

Run `yarn workspace @trm/server dev` and `yarn workspace @trm/web dev`, start a room with random
events enabled, play until a STAMP_RALLY/other bonus fires, and confirm: the "集章 +N" chip appears
top-center; triggering an insufficient-cards click shows a blue notice chip in the same stack; an
illegal action shows a red error chip in the same stack; copying the room link/code (from the lobby,
before starting) shows a green success chip in the same stack. Confirm multiple chips stack
vertically without overlapping.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles/game.css
git status  # confirm Toast.tsx shows as deleted
git add apps/web/src/components/Toast.tsx
git commit -m "$(cat <<'EOF'
refactor(web): remove the superseded Toast component and CSS

GameStage and RoomScreen both migrated to the unified notification
stack; nothing renders <Toast> or the old .toast* classes anymore.
EOF
)"
```

## Self-Review Notes

- **Spec coverage:** store generalization (Task 1), new component + CSS with all 5 variants and
  matching durations (Task 1), GameStage migration incl. the chat-rejection filter preserved
  (Task 2), RoomScreen migration (Task 3), Toast.tsx + old CSS deletion (Task 4), sandbox/replay
  isolation preserved by construction (Task 1 reuses `useAnimationsStore`) — every spec section maps
  to a task.
- **Placeholder scan:** none — every step shows the exact before/after code or exact commands.
- **Type consistency:** `NotificationCue`/`pushNotification`/`removeNotification`/`notifications`
  names are used identically across Task 1 (definition), Task 2 (GameStage consumption), and Task 3
  (RoomScreen consumption). `DistributiveOmit` is defined once in Task 1 and only used there (the
  interface signature); callers just pass object literals, so no other file needs to reference it.
- **Sequencing check:** each task leaves `yarn typecheck`/`yarn lint`/`yarn workspace @trm/web test`
  green on its own — Task 1 leaves the old `Toast`/`.toast` CSS in place (still used by
  GameStage/RoomScreen) while adding the new plumbing unused-but-compiling; Tasks 2–3 each migrate
  one remaining consumer; Task 4 deletes dead code only after confirming (Step 1) nothing references
  it. No task depends on a later task to compile.
