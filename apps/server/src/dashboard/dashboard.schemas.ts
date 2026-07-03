import { z } from 'zod';
import { DASHBOARD_PERMISSIONS, DASHBOARD_ROLES } from '@trm/shared';

// zod is the single source for both validation (ZodValidationPipe + DTOs) and the
// OpenAPI schemas (apiSchema()), per the auth/maps modules.

export const DashboardRoleSchema = z.enum(DASHBOARD_ROLES);
export const DashboardPermissionSchema = z.enum(DASHBOARD_PERMISSIONS);

export const DashboardMeSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  role: DashboardRoleSchema,
  permissions: z.array(DashboardPermissionSchema),
});
