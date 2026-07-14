import { DISCORD_URL } from '@trm/client-core/links';

export { DISCORD_URL };

export function openDiscord(): void {
  window.open(DISCORD_URL, '_blank', 'noopener,noreferrer');
}
