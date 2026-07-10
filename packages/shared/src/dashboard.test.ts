import { describe, it, expect } from 'vitest';
import { DASHBOARD_PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions } from './dashboard';

describe('dashboard permission taxonomy', () => {
  it('includes games.spectateLive as a known permission', () => {
    expect(DASHBOARD_PERMISSIONS).toContain('games.spectateLive');
  });

  it('grants games.spectateLive at the viewer tier (same as games.viewReplay)', () => {
    expect(ROLE_PERMISSIONS.viewer).toContain('games.spectateLive');
    expect(effectivePermissions('viewer').has('games.spectateLive')).toBe(true);
  });
});
