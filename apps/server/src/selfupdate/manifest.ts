// Fetching + verifying an OTA manifest (docs/release/server-ota.md).
//
// Hot-loading code into this process is the most privileged operation in the system, so a manifest is
// only ever trusted after BOTH gates pass:
//
//   1. an ed25519 signature over the manifest payload's exact bytes, and
//   2. the manifest's own sha256 of the bundle, checked against what was downloaded.
//
// The published file is an envelope — `{ payload: base64, signature: base64 }` — so the signature
// covers bytes rather than a re-serialised object (signer and verifier cannot drift on key order) and
// the pair is published as ONE asset, so no deploy leaves a window where a new payload is paired with
// an old signature. tooling/ota/buildBundle.mjs writes it.
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import { z } from 'zod';
import { isSafeOwnedPath, MAX_OWNED_PATHS } from './layout';

/** The only manifest schema this build understands. A newer one is rejected, not guessed at. */
export const SUPPORTED_MANIFEST_SCHEMA = 1;

/** Bounds on what a fetch will read before giving up — an unauthenticated endpoint decides these
 *  sizes, so they are capped before anything is buffered. */
const MAX_MANIFEST_BYTES = 64 * 1024;
/** A real bundle is ~5MB (source + both web bundles; the OG fonts ride in the image — see
 *  tooling/ota/depsFingerprint.mjs). The cap is what bounds peak memory during a download, since the
 *  archive is buffered to hash it before anything touches the filesystem. */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

const manifestSchema = z.object({
  schema: z.number().int(),
  commit: z
    .string()
    .min(7)
    .max(64)
    .regex(/^[0-9a-zA-Z._-]+$/, 'commit is used as a directory name'),
  builtAt: z.string().min(1),
  depsFingerprint: z.string().min(8),
  webBuildId: z.string().min(1).max(64),
  paths: z.array(z.string()).min(1).max(MAX_OWNED_PATHS),
  bundle: z.object({
    name: z.string().min(1).max(128),
    url: z.string().url(),
    size: z.number().int().positive().max(MAX_BUNDLE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});

export type OtaManifest = z.infer<typeof manifestSchema>;

export class ManifestRejected extends Error {
  constructor(readonly reason: string) {
    super(`OTA manifest rejected: ${reason}`);
  }
}

/**
 * Accepts a PEM public key, or the base64 of one (which is how `tooling/ota/keygen.mjs` prints it, so
 * it survives a GitHub/Portainer env field without newline mangling).
 */
export function parsePublicKey(configured: string): KeyObject {
  const text = configured.includes('-----BEGIN')
    ? configured
    : Buffer.from(configured, 'base64').toString('utf8');
  const key = createPublicKey(text);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`TRM_SELFUPDATE_PUBLIC_KEY must be ed25519, got ${key.asymmetricKeyType}`);
  }
  return key;
}

const envelopeSchema = z.object({ payload: z.string().min(1), signature: z.string() });

/**
 * Verify + parse a published manifest envelope. The signature is checked BEFORE the payload is
 * interpreted as anything but bytes, so nothing downstream ever sees unauthenticated structure.
 */
export function verifyManifest(envelopeBytes: Buffer, key: KeyObject): OtaManifest {
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(envelopeBytes.toString('utf8')));
  } catch {
    throw new ManifestRejected('malformed_envelope');
  }
  const payload = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.byteLength === 0 || !verifySignature(null, payload, key, signature)) {
    throw new ManifestRejected('bad_signature');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new ManifestRejected('malformed_json');
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw new ManifestRejected('schema_mismatch');
  const manifest = result.data;
  if (manifest.schema !== SUPPORTED_MANIFEST_SCHEMA)
    throw new ManifestRejected('unsupported_schema');
  if (!manifest.paths.every(isSafeOwnedPath)) throw new ManifestRejected('unsafe_path');
  return manifest;
}

export interface FetchedManifest {
  manifest: OtaManifest;
  /** Server's ETag, replayed as If-None-Match so an unchanged manifest costs a 304. */
  etag: string | null;
}

async function readCapped(response: Response, limit: number, what: string): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > limit) throw new ManifestRejected(`${what}_too_large`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new ManifestRejected(`${what}_too_large`);
  return bytes;
}

/**
 * Fetch + verify the manifest. `null` means "nothing new" (a 304 against `etag`).
 *
 * The manifest is a public, anonymously readable release asset — there is no credential on the
 * deployment to leak, and a tampered copy fails the signature check.
 */
export async function fetchManifest(
  manifestUrl: string,
  key: KeyObject,
  etag: string | null,
  signal?: AbortSignal,
): Promise<FetchedManifest | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (etag !== null) headers['if-none-match'] = etag;
  const response = await fetch(manifestUrl, {
    headers,
    ...(signal === undefined ? {} : { signal }),
    redirect: 'follow',
  });
  if (response.status === 304) return null;
  if (!response.ok) throw new ManifestRejected(`manifest_http_${response.status}`);
  const bytes = await readCapped(response, MAX_MANIFEST_BYTES, 'manifest');
  return { manifest: verifyManifest(bytes, key), etag: response.headers.get('etag') };
}

/** sha256 of `bytes`, hex — the digest a downloaded bundle is checked against. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
