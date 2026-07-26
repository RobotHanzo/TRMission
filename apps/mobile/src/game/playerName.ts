import { useTranslation } from 'react-i18next';
import { playerAvatar, type PlayerAvatar } from '@trm/client-core/game/playerAvatar';
import { useRoster } from '../store/roster';
import { useModeration } from '../store/moderation';

/**
 * A label resolver for an in-game player. Prefers the lobby roster (real account names, or a
 * localized "難度機器人" label for bots) and falls back to `P{seat+1}` when the roster has not
 * loaded yet. The viewer themself is always shown as "you". A blocked player's display name is
 * itself UGC, so it is masked to the neutral seat label.
 */
export function usePlayerName(): (player: { id: string; seat: number; isMe?: boolean }) => string {
  const { t } = useTranslation();
  const byId = useRoster((s) => s.byId);
  const blocked = useModeration((s) => s.blocked);
  return ({ id, seat, isMe }) => {
    if (isMe) return t('you');
    const m = byId[id];
    if (m?.isBot) return t('botName', { level: t(`difficulty_${m.difficulty ?? 'EASY'}`) });
    if (blocked.has(id)) return `P${seat + 1}`;
    if (m?.displayName) return m.displayName;
    return `P${seat + 1}`;
  };
}

/**
 * How to picture a player: their account picture, or a bot / guest glyph, or the initial of the
 * label `usePlayerName` resolved. A blocked player's picture is suppressed for the same reason
 * their name is — it is UGC, and it would undo the masking the name already applied.
 */
export function usePlayerAvatar(): (player: {
  id: string;
  seat: number;
  displayName: string;
}) => PlayerAvatar {
  const byId = useRoster((s) => s.byId);
  const blocked = useModeration((s) => s.blocked);
  return ({ id, displayName }) => {
    const m = byId[id];
    return playerAvatar({
      displayName,
      isBot: m?.isBot ?? id.startsWith('bot:'),
      isGuest: m?.isGuest,
      avatarUrl: m?.avatarUrl,
      masked: blocked.has(id),
    });
  };
}
