/**
 * Maintainer-dashboard access-control taxonomy.
 *
 * Defined once here so the server's guard and the admin UI's gating can never
 * drift: the server computes a maintainer's effective permission set with
 * `effectivePermissions` and so does `apps/admin` (from the same stored
 * role + overrides, returned by `GET /dashboard/me`).
 *
 * Roles are fixed names that expand to permission sets in code; only the
 * per-account overrides (`extraPermissions` / `deniedPermissions`) live in
 * Mongo. Adding a permission is a change to this file (and the role map),
 * never a data migration.
 */

/** Every discrete dashboard capability, checked individually by the server guard. */
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
export type DashboardPermission = (typeof DASHBOARD_PERMISSIONS)[number];

export const DASHBOARD_ROLES = ['viewer', 'moderator', 'admin', 'owner'] as const;
export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

const VIEWER_PERMISSIONS: readonly DashboardPermission[] = [
  'overview.read',
  'users.read',
  'games.read',
  'rooms.read',
  'games.viewReplay',
  'games.spectateLive',
  'maps.read',
  'ratings.read',
];

const MODERATOR_PERMISSIONS: readonly DashboardPermission[] = [
  ...VIEWER_PERMISSIONS,
  'users.ban',
  'users.tutorialReset',
  'games.readLog',
  'games.terminate',
  'rooms.close',
];

const ADMIN_PERMISSIONS: readonly DashboardPermission[] = [
  ...MODERATOR_PERMISSIONS,
  'users.features',
  'users.delete',
  'maintainers.read',
  'audit.read',
  'games.delete',
  'rooms.delete',
  'purge.read',
  'purge.run',
  'maps.moderate',
  'config.features',
];

/** Role → permission set. Strict escalation chain; only `owner` can manage maintainers. */
export const ROLE_PERMISSIONS: Record<DashboardRole, readonly DashboardPermission[]> = {
  viewer: VIEWER_PERMISSIONS,
  moderator: MODERATOR_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  owner: DASHBOARD_PERMISSIONS,
};

export const isDashboardPermission = (p: string): p is DashboardPermission =>
  (DASHBOARD_PERMISSIONS as readonly string[]).includes(p);

export const isDashboardRole = (r: string): r is DashboardRole =>
  (DASHBOARD_ROLES as readonly string[]).includes(r);

/** (role's permissions ∪ extra) − denied. Denied always wins, including over extra. */
export function effectivePermissions(
  role: DashboardRole,
  extra: readonly DashboardPermission[] = [],
  denied: readonly DashboardPermission[] = [],
): Set<DashboardPermission> {
  const result = new Set<DashboardPermission>(ROLE_PERMISSIONS[role]);
  for (const p of extra) result.add(p);
  for (const p of denied) result.delete(p);
  return result;
}
