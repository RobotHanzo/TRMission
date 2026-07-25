# CLAUDE.md

`src/account/` is the **account-deletion cascade**: `DELETE /auth/me` (Bearer; optional
`{appleAuthorizationCode}` from a fresh Sign in with Apple re-auth for token revocation,
best-effort — `apple-token-revoker.ts`, credentials in `src/auth/CLAUDE.md`).

What it deletes: `users`, `authSessions`, `customMaps` drafts; it leaves LOBBY rooms via
`RoomRepo.leave` and `$pull`s the account out of `matchHistory` spectators.

What deliberately **stays**: the event-sourced game log, `mapContents`, and `dashboardAudit` —
dangling opaque ids are the same posture as guest TTL expiry, and removing them would break other
players' replays and the audit trail.

Maintainers get **409** until their dashboard access is revoked (`src/dashboard/CLAUDE.md`).
