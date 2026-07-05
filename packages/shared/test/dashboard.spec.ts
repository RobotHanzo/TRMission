import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_PERMISSIONS,
  DASHBOARD_ROLES,
  ROLE_PERMISSIONS,
  effectivePermissions,
  isDashboardPermission,
  isDashboardRole,
} from '../src/dashboard';

describe('dashboard permission taxonomy', () => {
  it('every role maps only to known permissions', () => {
    for (const role of DASHBOARD_ROLES) {
      for (const perm of ROLE_PERMISSIONS[role]) {
        expect(DASHBOARD_PERMISSIONS).toContain(perm);
      }
    }
  });

  it('roles form a strict escalation chain (viewer ⊂ moderator ⊂ admin ⊂ owner)', () => {
    const sets = {
      viewer: new Set(ROLE_PERMISSIONS.viewer),
      moderator: new Set(ROLE_PERMISSIONS.moderator),
      admin: new Set(ROLE_PERMISSIONS.admin),
      owner: new Set(ROLE_PERMISSIONS.owner),
    };
    for (const p of sets.viewer) expect(sets.moderator.has(p)).toBe(true);
    for (const p of sets.moderator) expect(sets.admin.has(p)).toBe(true);
    for (const p of sets.admin) expect(sets.owner.has(p)).toBe(true);
    expect(sets.moderator.size).toBeGreaterThan(sets.viewer.size);
    expect(sets.admin.size).toBeGreaterThan(sets.moderator.size);
    expect(sets.owner.size).toBeGreaterThan(sets.admin.size);
  });

  it('only owner holds maintainers.write; owner holds every permission', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('maintainers.write');
    expect(ROLE_PERMISSIONS.moderator).not.toContain('maintainers.write');
    expect(ROLE_PERMISSIONS.admin).not.toContain('maintainers.write');
    expect(new Set(ROLE_PERMISSIONS.owner)).toEqual(new Set(DASHBOARD_PERMISSIONS));
  });

  it('effectivePermissions = (role ∪ extra) − denied', () => {
    const base = effectivePermissions('viewer');
    expect(base.has('overview.read')).toBe(true);
    expect(base.has('games.terminate')).toBe(false);

    const boosted = effectivePermissions('viewer', ['games.terminate']);
    expect(boosted.has('games.terminate')).toBe(true);

    const restricted = effectivePermissions('admin', [], ['audit.read']);
    expect(restricted.has('audit.read')).toBe(false);
    expect(restricted.has('users.read')).toBe(true);
  });

  it('denied wins over extra for the same permission', () => {
    const perms = effectivePermissions('viewer', ['users.ban'], ['users.ban']);
    expect(perms.has('users.ban')).toBe(false);
  });

  it('effectivePermissions tolerates undefined overrides', () => {
    expect(effectivePermissions('moderator', undefined, undefined).has('rooms.close')).toBe(true);
  });

  it('type guards accept members and reject strangers', () => {
    expect(isDashboardPermission('users.read')).toBe(true);
    expect(isDashboardPermission('users.write')).toBe(false);
    expect(isDashboardRole('owner')).toBe(true);
    expect(isDashboardRole('root')).toBe(false);
  });

  it('maps.read is a viewer permission; maps.moderate is admin-tier', () => {
    expect(ROLE_PERMISSIONS.viewer).toContain('maps.read');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('maps.moderate');
    expect(ROLE_PERMISSIONS.moderator).not.toContain('maps.moderate');
    expect(ROLE_PERMISSIONS.admin).toContain('maps.moderate');
    expect(ROLE_PERMISSIONS.admin).toContain('maps.read');
  });
});
