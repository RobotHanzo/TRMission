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

export interface PushTransport {
  readonly platform: 'ios' | 'android';
  /** 'prune' = the platform says this token is permanently dead — drop it from the registry. */
  send(token: string, msg: PushMessage): Promise<PushDelivery>;
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

/** Direct APNs over Node's built-in HTTP/2 client — token auth needs no APNs library. */
export class ApnsTransport implements PushTransport {
  readonly platform = 'ios' as const;
  private readonly log = new Logger('ApnsTransport');
  private readonly provider = new ApnsProviderToken();

  private get host(): string {
    return env.apnsSandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  }

  async send(token: string, msg: PushMessage): Promise<PushDelivery> {
    try {
      const bearer = await this.provider.get();
      return await new Promise<PushDelivery>((resolve) => {
        const session = connect(this.host);
        session.on('error', () => resolve('error'));
        const req = session.request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${bearer}`,
          'apns-topic': env.apnsBundleId,
          'apns-push-type': 'alert',
          'apns-priority': '10',
        });
        let status = 0;
        req.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0);
        });
        req.on('error', () => {
          session.close();
          resolve('error');
        });
        req.on('close', () => {
          session.close();
          if (status === 200) resolve('ok');
          else if (status === 410)
            resolve('prune'); // Unregistered
          else {
            this.log.warn(`apns send failed: ${status}`);
            resolve('error');
          }
        });
        req.end(JSON.stringify(apnsBody(msg)));
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
