// Re-project the replay from any seat's perspective (their hand/tickets become visible) or
// the public (null-viewer) projection — the "as they experienced it" toggle.
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { asPlayerId, type PlayerId } from '@trm/shared';
import type { ReplayPlayerMeta } from '../../net/rest';
import { usePlayerName } from '../../game/playerName';
import { SEAT_COLORS } from '../../theme/colors';

export function PerspectiveSwitcher({
  players,
  viewer,
  onChange,
}: {
  players: ReplayPlayerMeta[];
  viewer: PlayerId | null;
  onChange(viewer: PlayerId | null): void;
}) {
  const { t } = useTranslation();
  const nameOf = usePlayerName();
  return (
    <div className="card perspective-switcher">
      <div className="perspective-label">{t('history.perspective')}</div>
      <div className="perspective-pills">
        <button
          className={'perspective-pill' + (viewer === null ? ' is-active' : '')}
          onClick={() => onChange(null)}
        >
          <Eye size={14} aria-hidden /> {t('history.publicView')}
        </button>
        {[...players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => (
            <button
              key={p.userId}
              className={
                'perspective-pill' + ((viewer as string | null) === p.userId ? ' is-active' : '')
              }
              onClick={() => onChange(asPlayerId(p.userId))}
            >
              <span
                className="perspective-dot"
                style={{ background: SEAT_COLORS[p.seat] ?? '#888' }}
                aria-hidden
              />
              {nameOf({ id: p.userId, seat: p.seat })}
            </button>
          ))}
      </div>
    </div>
  );
}
