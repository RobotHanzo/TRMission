import { Injectable } from '@nestjs/common';
import { SupportConfig } from './support.config';

/** How long we wait on Discord before giving up — the sender is holding an open request. */
const WEBHOOK_TIMEOUT_MS = 10_000;

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  /** Decimal RGB, Discord's own encoding for the embed's left rule. */
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
  footer?: { text: string };
}

export interface DiscordMessage {
  username?: string;
  embeds: DiscordEmbed[];
}

/** The single seam that talks to Discord over the network — faked in e2e (`FakeDiscordWebhook`). */
export interface DiscordWebhook {
  send(message: DiscordMessage): Promise<void>;
}

export const DISCORD_WEBHOOK = Symbol('DISCORD_WEBHOOK');

@Injectable()
export class FetchDiscordWebhook implements DiscordWebhook {
  constructor(private readonly config: SupportConfig) {}

  async send(message: DiscordMessage): Promise<void> {
    if (!this.config.formEnabled) throw new Error('no support webhook is configured');
    const res = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `allowed_mentions: {parse: []}` is a security control, not a nicety: every field below
      // carries user-supplied text, and without it an "@everyone" typed into the support form
      // would ping the whole server from a webhook nobody can mute.
      body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`discord webhook rejected the message (${res.status})`);
  }
}
