import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import type { GameSnapshot } from '@trm/proto';
import { CARD_COLORS, type CardColor } from '@trm/shared';
import {
  myTeamPool,
  canPushToPool,
  canTakeFromPool,
  isTeamGame,
} from '@trm/client-core/game/teams';
import { handFromCounts } from '../game/payments';
import { CARD_COLOR_TOKENS, LOCOMOTIVE_GRADIENT, teamColor } from '../theme/colors';

interface Props {
  snapshot: GameSnapshot;
  onPush(color: CardColor): void;
  onTake(color: CardColor): void;
}

/**
 * The team's public card pool — the only channel partners may pass cards through, since hands stay
 * secret even from a teammate. Rendered for every viewer (including spectators and the opposing
 * team): the pool is open information by design, which is what makes it a signalling device.
 *
 * Legality mirrors the reducer via `@trm/client-core/game/teams`, so controls disable instead of
 * letting the server reject.
 */
export function TeamPoolPanel({ snapshot, onPush, onTake }: Props) {
  const { t } = useTranslation();
  if (!isTeamGame(snapshot)) return null;
  const pool = myTeamPool(snapshot);
  if (!pool) return null;

  const hand = handFromCounts(snapshot.you?.hand);
  const pushUsed = snapshot.you?.teamPushUsed ?? false;
  const full = pool.count >= pool.capacity;
  const hint = pushUsed ? t('teamPoolPushUsed') : full ? t('teamPoolFull') : t('teamPoolHint');

  return (
    <section className="team-pool" aria-label={t('teamPool')}>
      <header className="row between">
        <span className="row">
          <Users size={15} aria-hidden />
          <strong style={{ color: teamColor(pool.team) }}>{t('teamPool')}</strong>
        </span>
        <span className="muted">{t('teamPoolCount', { n: pool.count, max: pool.capacity })}</span>
      </header>

      <div className="team-pool-cards">
        {pool.count === 0 && <span className="muted">{t('teamPoolEmpty')}</span>}
        {CARD_COLORS.filter((c) => pool.cards[c] > 0).map((color) => {
          const tok = CARD_COLOR_TOKENS[color];
          const isLoco = color === 'LOCOMOTIVE';
          return (
            <button
              key={color}
              className="team-pool-card"
              disabled={!canTakeFromPool(snapshot, color)}
              onClick={() => onTake(color)}
              title={t('teamPoolTake')}
              aria-label={`${t('teamPoolTake')}: ${tok.nameZh}`}
              style={{ background: isLoco ? LOCOMOTIVE_GRADIENT : tok.hex, color: tok.ink }}
            >
              {tok.glyph}
              <span className="team-pool-qty">{pool.cards[color]}</span>
            </button>
          );
        })}
      </div>

      <div className="team-pool-push">
        <span className="muted">{hint}</span>
        <div className="team-pool-cards">
          {CARD_COLORS.filter((c) => hand[c] > 0).map((color) => {
            const tok = CARD_COLOR_TOKENS[color];
            const isLoco = color === 'LOCOMOTIVE';
            return (
              <button
                key={color}
                className="team-pool-card is-push"
                disabled={!canPushToPool(snapshot, color)}
                onClick={() => onPush(color)}
                title={t('teamPoolPush')}
                aria-label={`${t('teamPoolPush')}: ${tok.nameZh}`}
                style={{ background: isLoco ? LOCOMOTIVE_GRADIENT : tok.hex, color: tok.ink }}
              >
                {tok.glyph}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
