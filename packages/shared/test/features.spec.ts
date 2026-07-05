import { describe, it, expect } from 'vitest';
import { USER_FEATURES, isUserFeature } from '../src/features';
import { ROLE_PERMISSIONS } from '../src/dashboard';

describe('user feature taxonomy', () => {
  it('defines exactly the three gated features', () => {
    expect(USER_FEATURES).toEqual(['replayReview', 'mapBuilder', 'randomEvents']);
  });

  it('type guard accepts members and rejects strangers', () => {
    expect(isUserFeature('replayReview')).toBe(true);
    expect(isUserFeature('mapBuilder')).toBe(true);
    expect(isUserFeature('randomEvents')).toBe(true);
    expect(isUserFeature('timeTravel')).toBe(false);
  });

  it('users.features is granted to admin and owner, not viewer/moderator', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('users.features');
    expect(ROLE_PERMISSIONS.moderator).not.toContain('users.features');
    expect(ROLE_PERMISSIONS.admin).toContain('users.features');
    expect(ROLE_PERMISSIONS.owner).toContain('users.features');
  });
});
