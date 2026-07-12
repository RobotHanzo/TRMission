// The ONLY offline randomness source. Randomness stays OUTSIDE the engine (ADR A4):
// it enters a game exactly once, as GameConfig.seed — the same boundary as the server's
// randomUUID() seed in LobbyService.start.
import * as Crypto from 'expo-crypto';

export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  Crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomGameId(): string {
  return `local:${Crypto.randomUUID()}`;
}
