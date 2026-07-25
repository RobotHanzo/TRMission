import { Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import { connect } from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';
import { env } from '../config/env';

export type PushDelivery = 'ok' | 'prune' | 'error';

export interface PushMessage {
  title: string;
  body: string;
  /** FCM requires string values; APNs carries these at the payload top level. */
  data: Record<string, string>;
}

/**
 * The mutable half of the iOS Live Activity (issue #43). Field-for-field the Swift `ContentState`
 * (apps/mobile/modules/live-activity/ios/TRMissionActivityAttributes.swift) and the TS
 * `LiveActivityContent` (apps/mobile/modules/live-activity/index.ts) — this object is serialized
 * verbatim as the APNs `content-state`, so a renamed field here silently blanks the widget.
 *
 * Numbers and booleans only, by design: the server never needs (and must never push) a display
 * name, a card, or anything else from another player's hidden state.
 */
export interface LiveActivityState {
  /** Seat on the clock; -1 = nobody (game over). */
  currentSeat: number;
  /** The RECIPIENT's own remaining train cars. */
  myTrains: number;
  /** The RECIPIENT's own route points so far. */
  myScore: number;
  /** Turns left in the final round; 0 = endgame not triggered. */
  finalTurnsRemaining: number;
  over: boolean;
  /** Epoch seconds the current turn lapses at (0 = no clock) — the widget's own countdown. */
  turnEndsAt: number;
}

export interface PushTransport {
  readonly platform: 'ios' | 'android';
  /** 'prune' = the platform says this token is permanently dead — drop it from the registry. */
  send(token: string, msg: PushMessage): Promise<PushDelivery>;
  /**
   * Push new Live Activity content to ONE activity's ActivityKit token. iOS only — absent on the
   * Android transport, so callers must check for it (`transport.sendLiveActivity?.(…)`).
   * `end` shows the final state and then retires the card.
   */
  sendLiveActivity?(
    token: string,
    state: LiveActivityState,
    event: 'update' | 'end',
  ): Promise<PushDelivery>;
}

export const PUSH_TRANSPORTS = Symbol('PUSH_TRANSPORTS');

/** FCM v1 request body (exported pure for tests). */
export const fcmBody = (token: string, msg: PushMessage): { message: Record<string, unknown> } => ({
  message: { token, notification: { title: msg.title, body: msg.body }, data: msg.data },
});

/** APNs request body (exported pure for tests): custom keys ride at the top level. */
export const apnsBody = (msg: PushMessage): Record<string, unknown> => ({
  aps: { alert: { title: msg.title, body: msg.body }, sound: 'default' },
  ...msg.data,
});

/** How long the final "game over" card lingers before iOS retires it (matches the app's own end). */
const LIVE_ACTIVITY_DISMISS_AFTER_SECONDS = 120;

/**
 * ActivityKit update payload (exported pure for tests). `timestamp` is what APNs uses to discard
 * out-of-order updates, so it must be seconds and monotonic per activity; `content-state` is the
 * Codable `ContentState` verbatim. An `end` event also carries `dismissal-date`, otherwise a
 * finished game's card would sit on the lock screen until ActivityKit's own multi-hour timeout.
 */
export const apnsLiveActivityBody = (
  state: LiveActivityState,
  event: 'update' | 'end',
  nowSeconds: number,
): Record<string, unknown> => ({
  aps: {
    timestamp: nowSeconds,
    event,
    'content-state': state,
    ...(event === 'end'
      ? { 'dismissal-date': nowSeconds + LIVE_ACTIVITY_DISMISS_AFTER_SECONDS }
      : {}),
  },
});

/** Direct FCM HTTP v1: google-auth-library mints the bearer from the service-account key. */
export class FcmTransport implements PushTransport {
  readonly platform = 'android' as const;
  private readonly log = new Logger('FcmTransport');
  private readonly jwt = new JWT({
    email: env.fcmClientEmail,
    key: env.fcmPrivateKey,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  async send(token: string, msg: PushMessage): Promise<PushDelivery> {
    try {
      const { token: bearer } = await this.jwt.getAccessToken();
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${env.fcmProjectId}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify(fcmBody(token, msg)),
        },
      );
      if (res.ok) return 'ok';
      if (res.status === 404) return 'prune'; // UNREGISTERED — token will never be valid again
      this.log.warn(`fcm send failed: ${res.status}`);
      return 'error';
    } catch (e) {
      this.log.warn(`fcm error: ${(e as Error).message}`);
      return 'error';
    }
  }
}

/**
 * APNs ES256 provider token, cached ~40 minutes — Apple rejects tokens older than 1h
 * (ExpiredProviderToken) and asks for regeneration no more than every 20 minutes.
 */
export class ApnsProviderToken {
  private token = '';
  private mintedAt = 0;

  async get(): Promise<string> {
    if (this.token && Date.now() - this.mintedAt < 40 * 60 * 1000) return this.token;
    const key = await importPKCS8(env.apnsPrivateKey, 'ES256');
    this.token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: env.apnsKeyId })
      .setIssuer(env.apnsTeamId)
      .setIssuedAt()
      .sign(key);
    this.mintedAt = Date.now();
    return this.token;
  }
}

/**
 * An APNs device token is a fixed-length hex string (32 bytes / 64 hex chars on current APNs; a
 * generous upper bound is kept for older/alternate encodings). Enforced again here — on top of
 * the registration-time check in `push.schemas.ts` — because `token` is spliced verbatim into the
 * outbound HTTP/2 `:path` pseudo-header below: a row written before that schema validation
 * existed must not be able to reintroduce request-line injection via this sink.
 */
const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
/** Same posture for the (longer) ActivityKit push token; mirrors `RegisterLiveActivitySchema`. */
const LIVE_ACTIVITY_TOKEN_RE = /^[0-9a-fA-F]{64,512}$/;

/** Direct APNs over Node's built-in HTTP/2 client — token auth needs no APNs library. */
export class ApnsTransport implements PushTransport {
  readonly platform = 'ios' as const;
  private readonly log = new Logger('ApnsTransport');
  private readonly provider = new ApnsProviderToken();

  private get host(): string {
    return env.apnsSandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  }

  async send(token: string, msg: PushMessage): Promise<PushDelivery> {
    if (!APNS_TOKEN_RE.test(token)) {
      this.log.warn('apns send skipped: malformed device token');
      return 'error';
    }
    return this.post(
      token,
      {
        'apns-topic': env.apnsBundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      apnsBody(msg),
      'send',
    );
  }

  /**
   * A Live Activity update goes to the SAME device path but a dedicated topic suffix and push type
   * — that pairing is what makes APNs route it into ActivityKit instead of the notification centre.
   * The token is the per-activity ActivityKit token, never a device token.
   */
  async sendLiveActivity(
    token: string,
    state: LiveActivityState,
    event: 'update' | 'end',
  ): Promise<PushDelivery> {
    if (!LIVE_ACTIVITY_TOKEN_RE.test(token)) {
      this.log.warn('apns live-activity skipped: malformed push token');
      return 'error';
    }
    return this.post(
      token,
      {
        'apns-topic': `${env.apnsBundleId}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity',
        // 10 = deliver immediately: a turn handover is the one thing this feature exists for.
        'apns-priority': '10',
      },
      apnsLiveActivityBody(state, event, Math.floor(Date.now() / 1000)),
      'live-activity',
    );
  }

  /** The shared HTTP/2 round trip; `token` is spliced into `:path` only after a shape check above. */
  private async post(
    token: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    what: string,
  ): Promise<PushDelivery> {
    try {
      const bearer = await this.provider.get();
      return await new Promise<PushDelivery>((resolve) => {
        const session = connect(this.host);
        session.on('error', () => resolve('error'));
        const req = session.request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${bearer}`,
          ...headers,
        });
        let status = 0;
        req.on('response', (resHeaders) => {
          status = Number(resHeaders[':status'] ?? 0);
        });
        req.on('error', () => {
          session.close();
          resolve('error');
        });
        req.on('close', () => {
          session.close();
          if (status === 200) resolve('ok');
          else if (status === 410)
            resolve('prune'); // Unregistered / the activity is gone
          else {
            this.log.warn(`apns ${what} failed: ${status}`);
            resolve('error');
          }
        });
        req.end(JSON.stringify(body));
      });
    } catch (e) {
      this.log.warn(`apns error: ${(e as Error).message}`);
      return 'error';
    }
  }
}

/** A platform transport exists only when all of its credentials are configured. */
export const buildTransportsFromEnv = (): PushTransport[] => {
  const out: PushTransport[] = [];
  if (env.fcmProjectId && env.fcmClientEmail && env.fcmPrivateKey) out.push(new FcmTransport());
  if (env.apnsTeamId && env.apnsKeyId && env.apnsPrivateKey && env.apnsBundleId) {
    out.push(new ApnsTransport());
  }
  return out;
};
