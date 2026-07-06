import { useTranslation } from 'react-i18next';
import { useRoster } from '../store/roster';

/**
 * A label resolver for an in-game player. Prefers the lobby roster (real account names, or a
 * localized "機器人（難度）" label for bots) and falls back to `P{seat+1}` when the roster has not
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
