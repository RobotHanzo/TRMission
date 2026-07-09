import { describe, it, expect } from 'vitest';
import { parsePath, pathFor, useUi } from './ui';

describe('admin router path mapping', () => {
  it('parses base and view paths under /admin', () => {
    expect(parsePath('/admin/')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/admin')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/admin/users')).toEqual({ view: 'users', param: null });
    expect(parsePath('/admin/users/u-123')).toEqual({ view: 'users', param: 'u-123' });
    expect(parsePath('/admin/games/g%2F1')).toEqual({ view: 'games', param: 'g/1' });
    expect(parsePath('/admin/maintainers')).toEqual({ view: 'maintainers', param: null });
    expect(parsePath('/admin/audit')).toEqual({ view: 'audit', param: null });
  });

  it('unknown paths (including the retired /admin/login) fall back to overview', () => {
    expect(parsePath('/admin/nope')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/somewhere/else')).toEqual({ view: 'overview', param: null });
    expect(parsePath('/admin/login')).toEqual({ view: 'overview', param: null });
  });

  it('pathFor round-trips through parsePath', () => {
    expect(parsePath(pathFor('users', 'abc'))).toEqual({ view: 'users', param: 'abc' });
    expect(parsePath(pathFor('rooms'))).toEqual({ view: 'rooms', param: null });
    expect(parsePath(pathFor('overview'))).toEqual({ view: 'overview', param: null });
  });

  it('opens and closes the rooms detail drawer param', () => {
    useUi.getState().openDetail('rooms', 'ABCD');
    expect(useUi.getState().view).toBe('rooms');
    expect(useUi.getState().param).toBe('ABCD');
    useUi.getState().closeDetail();
    expect(useUi.getState().param).toBeNull();
  });
});
