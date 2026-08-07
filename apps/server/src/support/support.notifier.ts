import { Inject, Injectable } from '@nestjs/common';
import type { SupportCategory } from '@trm/shared';
import { SentryErrorReporter } from '../observability/error-reporter';
import { DISCORD_WEBHOOK, type DiscordEmbedField, type DiscordWebhook } from './discord-webhook';
import { SupportConfig } from './support.config';

/** The maintainer-facing identity of whoever submitted, resolved by the caller. */
export interface SupportSender {
  userId?: string;
  displayName?: string;
  isGuest?: boolean;
}

export interface SupportRequestNotification {
  category: SupportCategory;
  subject: string;
  message: string;
  email?: string;
  name?: string;
  platform?: string;
  appVersion?: string;
  sender: SupportSender;
}

export interface RatingNotification {
  stars: number;
  text?: string;
  gameId: string;
  roomId: string;
  sender: SupportSender;
}

const SUPPORT_COLOR = 0x1f6feb;
/** Red at one star through green at five — the card's severity is readable at a glance. */
const RATING_COLORS = [0xd7263d, 0xe8590c, 0xf1a208, 0x74b816, 0x2f9e44];

/** Discord's own per-field ceiling; everything we send is already schema-capped well below it,
 *  but truncate anyway so a future limit change can't turn into a rejected webhook. */
const FIELD_MAX = 1024;
const clip = (v: string, max = FIELD_MAX): string =>
  v.length <= max ? v : `${v.slice(0, max - 1)}…`;

const field = (name: string, value: string | undefined): DiscordEmbedField[] =>
  value ? [{ name, value: clip(value) }] : [];

/** "Ada (registered · u_123)" — enough for a maintainer to find the account, nothing more. */
function describeSender(sender: SupportSender): string {
  if (!sender.userId) return 'Anonymous (not signed in)';
  const kind = sender.isGuest ? 'guest' : 'registered';
  return `${sender.displayName ?? '—'} (${kind} · ${sender.userId})`;
}

/**
 * Formats support requests and app ratings into the ONE Discord webhook that is the
 * maintainer's inbox (issue #80), and owns the difference in how a delivery failure is treated:
 *
 * - A **support request** is not stored anywhere else, so `supportRequest` rejects and the
 *   controller turns that into a 502 — the sender is told to use the e-mail/Discord fallback
 *   instead of believing a message was delivered when it wasn't.
 * - A **rating** is already durable in `gameRatings` (and readable in the dashboard), so
 *   `rating` is fire-and-forget: a webhook outage must never fail a player's submission.
 */
@Injectable()
export class SupportNotifier {
  constructor(
    @Inject(DISCORD_WEBHOOK) private readonly webhook: DiscordWebhook,
    private readonly config: SupportConfig,
    private readonly reporter: SentryErrorReporter,
  ) {}

  get enabled(): boolean {
    return this.config.formEnabled;
  }

  async supportRequest(req: SupportRequestNotification): Promise<void> {
    const context = [req.platform, req.appVersion].filter(Boolean).join(' · ');
    await this.webhook.send({
      username: 'TRMission Support',
      embeds: [
        {
          title: clip(`[${req.category}] ${req.subject}`, 256),
          description: clip(req.message, 4096),
          color: SUPPORT_COLOR,
          fields: [
            { name: 'From', value: clip(describeSender(req.sender)) },
            ...field('Reply to', req.email ?? '(no address given — cannot reply)'),
            ...field('Name given', req.name),
            ...field('Client', context),
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  /** Best-effort; never awaited by the rating route. */
  rating(r: RatingNotification): void {
    if (!this.enabled) return;
    const stars = Math.min(5, Math.max(1, Math.round(r.stars)));
    void this.webhook
      .send({
        username: 'TRMission Ratings',
        embeds: [
          {
            title: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}  ${stars}/5`,
            ...(r.text ? { description: clip(r.text, 4096) } : {}),
            color: RATING_COLORS[stars - 1] ?? SUPPORT_COLOR,
            fields: [
              { name: 'From', value: clip(describeSender(r.sender)) },
              { name: 'Game', value: clip(`${r.gameId} (room ${r.roomId})`) },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .catch((err: unknown) => {
        this.reporter.capture(err, 'support.webhook', { kind: 'rating' });
      });
  }
}
