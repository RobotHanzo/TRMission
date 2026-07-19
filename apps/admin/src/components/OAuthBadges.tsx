import type { ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GoogleGlyph } from './icons/GoogleGlyph';
import { DiscordGlyph } from './icons/DiscordGlyph';
import { AppleGlyph } from './icons/AppleGlyph';

interface Props {
  oauthProviders: string[];
  hasPassword: boolean;
}

/** Compact per-method badges for a user's linked sign-in methods. Each badge is icon-only
 *  with a `title`/`aria-label` tooltip — consistent with other dense cells in this table
 *  that rely on `title` rather than always inlining text (e.g. the drawer's ID field). */
export function OAuthBadges({ oauthProviders, hasPassword }: Props) {
  const { t } = useTranslation();
  const badges: { key: string; label: string; icon: ReactNode }[] = [];
  if (oauthProviders.includes('google')) {
    badges.push({ key: 'google', label: t('users.oauthGoogle'), icon: <GoogleGlyph /> });
  }
  if (oauthProviders.includes('discord')) {
    badges.push({ key: 'discord', label: t('users.oauthDiscord'), icon: <DiscordGlyph /> });
  }
  if (oauthProviders.includes('apple')) {
    badges.push({ key: 'apple', label: t('users.oauthApple'), icon: <AppleGlyph /> });
  }
  if (hasPassword) {
    badges.push({
      key: 'password',
      label: t('users.oauthPassword'),
      icon: <KeyRound size={14} aria-hidden />,
    });
  }
  if (badges.length === 0) return <span className="oc-muted">—</span>;
  return (
    <span className="oc-oauth-badges">
      {badges.map((b) => (
        <span key={b.key} className="oc-oauth-badge" title={b.label} aria-label={b.label}>
          {b.icon}
        </span>
      ))}
    </span>
  );
}
