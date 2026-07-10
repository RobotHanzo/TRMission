// Vanity URL — redirects server-side to the invite link, so the invite can rotate without
// touching client code.
export const DISCORD_URL = 'https://trmission.robothanzo.dev/discord';

export function openDiscord(): void {
  window.open(DISCORD_URL, '_blank', 'noopener,noreferrer');
}
