// Community CTA target — the URL is shared with web via @trm/client-core; opening goes through
// the OS (system browser / Discord app) instead of window.open.
import { Linking } from 'react-native';
import { DISCORD_URL } from '@trm/client-core/links';

export { DISCORD_URL };

export function openDiscord(): void {
  Linking.openURL(DISCORD_URL).catch(() => undefined);
}
