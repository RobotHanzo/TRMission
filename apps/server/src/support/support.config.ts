import { Injectable, Optional } from '@nestjs/common';
import { env } from '../config/env';

export interface SupportConfigOverrides {
  webhookUrl?: string;
}

/**
 * Where support requests and app ratings are delivered. Same test pattern as `AuthConfig`:
 * Nest builds it from env with no args; specs bind `new SupportConfig(overrides)` via
 * `.useValue(...)`.
 *
 * The webhook is the ONLY inbox — nothing about a support request is persisted here (see
 * `CLAUDE.md`), so an unconfigured deployment must advertise the form as unavailable rather
 * than accept messages into a void. `formEnabled` is what both the client and the submit route
 * read to make that call.
 */
@Injectable()
export class SupportConfig {
  readonly webhookUrl: string;

  constructor(@Optional() overrides?: SupportConfigOverrides) {
    this.webhookUrl = overrides?.webhookUrl ?? env.supportDiscordWebhookUrl;
  }

  get formEnabled(): boolean {
    return this.webhookUrl.length > 0;
  }
}
