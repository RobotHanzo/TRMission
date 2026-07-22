import { useTranslation } from 'react-i18next';
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
