import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const RegisterDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  token: z.string().min(1).max(4096),
});
export const RemoveDeviceSchema = z.object({ token: z.string().min(1).max(4096) });

export class RegisterDeviceDto extends createZodDto(RegisterDeviceSchema) {}
export class RemoveDeviceDto extends createZodDto(RemoveDeviceSchema) {}
