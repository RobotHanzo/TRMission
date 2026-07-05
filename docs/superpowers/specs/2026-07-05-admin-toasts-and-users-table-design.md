# Admin: Action Toasts + Users Table Columns — Design

## Problem

Two gaps in the maintainer dashboard (`apps/admin`):

1. **No feedback on admin actions.** No toast/notification system exists anywhere in
   `apps/admin` (confirmed: no dependency, no component, zero matches for
   `toast|Toast|snackbar|Snackbar`). Every mutation either shows nothing on success, or —
   worse — 4 of 7 mutation call sites (ban/unban, terminate game, close room, revoke
   maintainer) have **no error handling at all**, so a failed request fails completely
   silently today (the button just re-enables, the dialog stays open, nothing else happens).
2. **The Users table is missing data the backend already half-has.** `oauthProviders` reaches
   the wire but isn't a column; guest TTL expiration (`guestExpiresAt`) exists on the user doc
   but is deliberately excluded from the dashboard projection; whether an account has a
   password at all isn't exposed in any form. Search is already debounced (250ms via an inline
   `setTimeout`, not Enter-key-gated as initially assumed) but the same snippet is duplicated
   in two files.

## Part 1 — Toast notification system

`apps/web` recently unified its own transient-notification chips into one system
(`store/animations.ts`'s `notifications` slice + `components/NotificationStack.tsx` — see
`docs/superpowers/specs/2026-07-05-unified-notification-chips-design.md`): a top-center stack
of self-expiring pill chips, variant-colored, two-phase mount→hold→exit animation, disabled
under `prefers-reduced-motion`.

`apps/admin` is a separate package with its own design system (`--oc-*` graphite tokens, not
`--tr-*`) and no shared UI package with `apps/web` exists — building one just for this would be
disproportionate. Instead, mirror the **same mechanism and interaction feel** using admin's own
tokens:

- **`apps/admin/src/store/toast.ts`** (new) — a zustand store, same shape/pattern as
  `useSession`/`useUi`:

  ```ts
  interface ToastCue {
    id: number;
    kind: 'success' | 'error';
    message: string;
  }
  interface ToastState {
    toasts: ToastCue[];
    push(kind: 'success' | 'error', message: string): void;
    remove(id: number): void;
  }
  ```

  `push` assigns an incrementing id and appends; no timers live in the store (kept in the
  component, matching `NotificationChip`'s per-chip-owns-its-timer approach).

- **`apps/admin/src/components/ToastStack.tsx`** (new) — `ToastChip` owns a hold-then-exit
  timer pair, same two-phase approach as `NotificationChip`: hold visible (success 2500ms,
  error 4000ms — errors need more reading time), then a 200ms exit fade before unmount.
  `ToastStack` renders all current toasts as a fixed top-center stack, `role="status"`, newest
  appended at the end.

- **CSS** (`admin.css`): new `.oc-toast-stack` / `.oc-toast-chip` rules, positioned
  `top: var(--oc-space-4)`, centered, pill shape. `--success` uses
  `var(--oc-signal-clear)`/`--oc-signal-clear-bg`, `--error` uses
  `var(--oc-signal-stop)`/`--oc-signal-stop-bg` (existing tokens, no new ones). Slide+fade
  keyframes mirroring `tr-toast-in`/`tr-toast-out`, respecting the existing
  `prefers-reduced-motion` block already in `admin.css`.

- **Mount point**: `<ToastStack />` once in `App.tsx`, as a shell-level sibling so it overlays
  every view regardless of nav state.

## Part 2 — Wire up toasts at every mutation site (and fix the silent-failure bug)

| Action            | File : function                     | Today                        | Change                                                                         |
| ----------------- | ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Ban / unban       | `UsersView.tsx` `toggleBan`         | no catch                     | add try/catch; success + error toast                                           |
| Save features     | `FeatureToggles.tsx` `save`         | catch → inline red text only | keep inline text; **add** success + error toast                                |
| Terminate game    | `GamesView.tsx` `terminate`         | no catch                     | add try/catch; success + error toast                                           |
| Close room        | `RoomsView.tsx` `close`             | no catch                     | add try/catch; success + error toast                                           |
| Save maintainer   | `MaintainersView.tsx` `Editor.save` | catch → inline red text only | keep inline text; **add** success + error toast                                |
| Revoke maintainer | `MaintainersView.tsx` `revoke`      | no catch                     | add try/catch; success + error toast                                           |
| Logout            | `session.ts` `logout`               | deliberately swallowed       | **out of scope** — not a meaningful user-facing action, swallow is intentional |

Error toast message: `e instanceof ApiError || e instanceof Error ? e.message : t('common.error')`
(matches the existing inline-error pattern already used in `FeatureToggles`/`Editor`). Success
toast messages are new i18n keys under a new `toast` namespace:

```
toast.userBanned, toast.userUnbanned, toast.featuresSaved, toast.gameTerminated,
toast.roomClosed, toast.maintainerSaved, toast.maintainerRevoked
```

added to both locale tables in `i18n/index.ts` (zh-Hant primary, en fallback — same key tree).

## Part 3 — Users table: two new columns

### Backend changes (`apps/server/src/dashboard/`)

`dashboard-users.service.ts`'s `toRow()` projection (the single explicit-projection function —
comment there says "never spread the doc") gains two fields:

```ts
const toRow = (u: UserDoc) => ({
  ...
  oauthProviders: Object.keys(u.oauth ?? {}),
  hasPassword: !!u.passwordHash,           // new — boolean only, never the hash
  ...
  ...(u.disabledAt ? { disabledAt: ... } : {}),
  ...(u.guestExpiresAt ? { guestExpiresAt: u.guestExpiresAt.toISOString() } : {}), // new
});
```

`hasPassword` matters because email presence doesn't imply a password: per the OAuth binding
rule (verified email → upgrade a live guest, else auto-link the same-email account, else create
a passwordless user), an account can have `email` set via OAuth with no `passwordHash` at all.

`dashboard.schemas.ts`: `DashboardUserRowSchema` gains
`hasPassword: z.boolean()` and `guestExpiresAt: z.string().optional()`.

`apps/admin/src/net/rest.ts`: `UserRow` gains the matching
`hasPassword: boolean; guestExpiresAt?: string;`.

### Frontend: `UsersView.tsx`

New column order (confirmed): **User / Email / Kind / OAuth / Status / Created / Expires**.

**OAuth column** — new shared component `apps/admin/src/components/OAuthBadges.tsx`, used in
both the table cell and the drawer (replacing the drawer's current plain
`oauthProviders.join(', ')` text line for visual consistency):

- One badge per linked provider in `oauthProviders` (`'google' | 'discord'`), plus a badge for
  `hasPassword`. A guest with neither renders `—`.
- Since lucide-react ships no brand logos, small monochrome inline SVGs (16px, `currentColor`,
  stroke-style matching lucide's visual weight) for Google/Discord live in
  `apps/admin/src/components/icons/` (`GoogleGlyph.tsx`, `DiscordGlyph.tsx`); the password badge
  reuses lucide's existing `KeyRound` icon.
- Each badge carries a `title` attribute with the method name (`t('users.oauthGoogle')` /
  `...Discord` / `...Password`) as its accessible text alternative — consistent with how other
  dense cells in this table already rely on `title` (e.g. the drawer's ID field) rather than
  always inlining text, given column-width constraints.

**Expires column**:

- Registered accounts (no `guestExpiresAt`): `—` (`common.never`).
- Active guest: `fmtDateTime(u.guestExpiresAt, locale)`.
- **Disabled guest with a pending `guestExpiresAt`** (edge case — the Mongo TTL keeps counting
  down independently of the ban): show the timestamp **plus a muted suffix**, e.g.
  `Jul 12, 03:00 <span class="oc-muted">（已停權）</span>` — a new i18n key
  `users.expiresDisabledSuffix`, since being disabled and TTL-expiring are two independent
  mechanisms (ban blocks access now; TTL deletes the doc later) and both facts are worth
  showing rather than picking one.

Same additions apply to the `UserDrawer` detail view: an "Expires" `oc-kv` row for guests
(with the same disabled-suffix handling), and `OAuthBadges` replacing the plain-text OAuth line.

New i18n keys for the two column headers: `users.colOauth`, `users.colExpires` (added to both
locale tables alongside the existing `colUser`/`colEmail`/`colKind`/`colCreated`/`colStatus`).

## Part 4 — Debounced search: extract the shared hook

`UsersView.tsx:227-230` and `AccountSelectorModal.tsx:30-53` each hand-roll the identical
`setTimeout`-in-`useEffect` debounce (250ms when typing, 0ms — instant — when the query is
cleared). This is already debounce-based, not Enter-key-gated; the ask here is to de-duplicate
it into a shared hook and move the delay to 300ms per the agreed default.

New `apps/admin/src/hooks/useDebouncedValue.ts`:

```ts
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

Call sites pass `delayMs: q.trim() ? 300 : 0`, preserving the existing "instant list on clear"
behavior; the resulting debounced value feeds each view's existing `load()` effect (replacing
the ad hoc timer there). `AccountSelectorModal`'s in-flight-request cancellation
(`cancelled` flag in its `.then`/`.catch`/`.finally` chain) is unchanged — only the timing
source moves into the shared hook.

## Non-goals

- No new dependency (no toast library, no icon library) — everything is built from existing
  primitives (zustand, the `oc-*` tokens, lucide's `KeyRound`, two small hand-rolled SVGs).
- No change to the Maintainers/Games/Rooms tables beyond wiring toasts into their existing
  mutation handlers — no new columns there.
- Logout is explicitly out of scope for toast coverage.
- No change to how `AccountSelectorModal` cancels in-flight requests — only its debounce timing
  source changes.

## Testing

- New `ToastStack`/`ToastChip` tests: renders each variant with correct text/class, auto-hides
  after its variant's hold duration, plays the exit phase before removal, stacks concurrent
  toasts in push order (mirrors the plan already used for `NotificationStack`'s own tests).
- Each updated mutation call site: existing tests still pass; add a case per previously-silent
  site (ban/unban, terminate, close, revoke) asserting a failed request now surfaces an error
  toast instead of failing invisibly.
- `useDebouncedValue` unit test: value updates after the delay, resets on rapid successive
  changes (only the last one fires).
- Backend: `apps/server/test/dashboard-read.e2e.spec.ts` (the existing user list/detail read
  coverage) gains assertions that a row never leaks `passwordHash` itself (only the `hasPassword`
  boolean) and correctly surfaces `guestExpiresAt` when present / omits it when absent.
- `yarn workspace @trm/admin test`, `yarn workspace @trm/server test`, `yarn lint`, `yarn typecheck`
  must pass before committing.
