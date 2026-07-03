import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { DashboardPermission } from '@trm/shared';

export const DASHBOARD_PERMISSION_KEY = 'dashboard:permission';

/**
 * Declares the dashboard permission a route needs. Enforced by DashboardGuard;
 * a route without this metadata only requires "is a maintainer" (i.e. /me).
 */
export const RequirePermission = (permission: DashboardPermission): CustomDecorator<string> =>
  SetMetadata(DASHBOARD_PERMISSION_KEY, permission);
