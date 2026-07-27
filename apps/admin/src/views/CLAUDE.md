# Views (`apps/admin/src/views/`)

App-wide context: `apps/admin/CLAUDE.md`. Server side: `apps/server/src/dashboard/CLAUDE.md`.

## The list-view shape

Every list view (`UsersView`, `GamesView`, `RoomsView`, `MaintainersView`) follows the same shape:
cursor-paginated `GET /dashboard/...` list + tabs/filter + search, each row opening a `Drawer` that
fetches its own detail on mount.

Destructive actions (disable user, terminate game, close room, revoke maintainer) always go through
`ConfirmDialog`, and the ones with real irreversible consequences (`terminate`, `disable`) pass
`withReason` — **read the `*ConfirmBody` i18n strings before changing this flow**; they document
exact consequences (e.g. terminating a game ends it with no scores and it can never be replayed; a
disabled account's already-issued access tokens keep read-only access for up to 15 minutes).

`AccountSelectorModal` is the shared search-as-you-type picker used wherever a flow needs to target
an arbitrary account (grant maintainer, grant a feature).

## No LIVE hidden information

`GamesView`'s action log (`GET /dashboard/games/:id/log`) is only ever fetched/rendered for
`COMPLETED` games (`games.readLog` permission) — a live game's log would reveal hidden information,
and the seed itself is withheld by the server (`seed` is `undefined`) while a game is `LIVE`.

Action buttons render behind `useSession((s) => s.hasPermission(...))`, which is UI convenience
only — the server enforces the same taxonomy independently (`../store/CLAUDE.md`).
