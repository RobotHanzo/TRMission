import { useTranslation } from 'react-i18next';
import { playerAvatar, type PlayerAvatar } from '@trm/client-core/game/playerAvatar';
import { useRoster } from '../store/roster';

/**
 * A label resolver for an in-game player. Prefers the lobby roster (real account names, or a
 * localized "難度機器人" label for bots) and falls back to `P{seat+1}` when the roster has not
 * loaded yet. The viewer themself is always shown as "you".
 */
export function usePlayerName(): (player: { id: string; seat: number; isMe?: boolean }) => string {
  const { t } = useTranslation();
  const byId = useRoster((s) => s.byId);
  return ({ id, seat, isMe }) => {
    if (isMe) return t('you');
    const m = byId[id];
    if (m?.isBot) return t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) });
    if (m?.displayName) return m.displayName;
    return `P${seat + 1}`;
  };
}

/**
 * How to picture a player: their account picture, or a bot / guest glyph, or the initial of the
 * label `usePlayerName` resolved. The viewer's own row is not special-cased — you see your own
 * picture at the table exactly as everyone else does.
 */
export function usePlayerAvatar(): (player: {
  id: string;
  seat: number;
  displayName: string;
}) => PlayerAvatar {
  const byId = useRoster((s) => s.byId);
  return ({ id, displayName }) => {
    const m = byId[id];
    return playerAvatar({
      displayName,
      isBot: m?.isBot ?? id.startsWith('bot:'),
      isGuest: m?.isGuest,
      avatarUrl: m?.avatarUrl,
    });
  };
}
