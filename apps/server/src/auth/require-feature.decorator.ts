import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { UserFeature } from '@trm/shared';

export const REQUIRE_FEATURE_KEY = 'auth:feature';

/**
 * Declares the per-account feature a route (or whole controller) needs.
 * Enforced by FeatureGuard; routes without this metadata pass through.
 */
export const RequireFeature = (feature: UserFeature): CustomDecorator<string> =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
