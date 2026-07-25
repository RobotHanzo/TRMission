import * as Crypto from 'expo-crypto';

/**
 * PKCE-style app-binding for the mobile OAuth redirect flow (Discord + Android Apple; F16
 * hardening). Without this, the exchange code minted at the OAuth callback is a pure bearer
 * capability handed back over the `trmission://` deep link — any co-installed app that also
 * registers that scheme can receive the same link and redeem the code for a full session.
 *
 * Generating a fresh, secret verifier before the flow starts and sending only its SHA-256 digest
 * (the "challenge") to `/oauth/:provider/start` lets `POST /auth/mobile/exchange` demand the
 * verifier back before it redeems the code — binding redemption to whichever app instance holds
 * the verifier in memory, not just whoever catches the deep link.
 *
 * Hex, not base64url: this pair never talks to a third-party PKCE-consuming library — it is a
 * bespoke app↔server binding, not the RFC 7636 exchange with the OAuth provider itself (that PKCE
 * already happens server-side; see the server's own `codeVerifier`/`codeChallenge` in
 * `oauth.service.ts`) — so a fixed-width hex encoding keeps this file free of hand-rolled base64
 * arithmetic while still matching the server's expected shape (`/^[0-9a-f]{64}$/`).
 */
export interface PkcePair {
  /** Kept in memory only, from generation through the final exchange POST. Never logged. */
  verifier: string;
  /** Sent as `?challenge=` when starting the flow. */
  challenge: string;
}

export async function generatePkcePair(): Promise<PkcePair> {
  const bytes = new Uint8Array(32);
  Crypto.getRandomValues(bytes);
  const verifier = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  return { verifier, challenge };
}
