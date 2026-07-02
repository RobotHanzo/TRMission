import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameSnapshot } from '@trm/proto';
import { useLogStore } from '../store/log';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS, CARD_COLOR_TOKENS } from '../theme/colors';
import { cityName, routeById } from '../game/content';
import type { CardColor } from '@trm/shared';
import type { LogEntry } from '../game/logModel';

const seatOf = (snapshot: GameSnapshot | null, playerId: string | null): number | null => {
  if (!snapshot || !playerId) return null;
  return snapshot.players.find((p) => p.id === playerId)?.seat ?? null;
};

export function LogPanel() {
  const { t } = useTranslation();
  const entries = useLogStore((s) => s.entries);
  const snapshot = useGameStore((s) => s.snapshot);
  const locale = useUi((s) => s.locale);
  const nameOf = usePlayerName();
  const me = snapshot?.you?.playerId ?? null;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const routeName = (id: string): string => {
    const r = routeById.get(id);
    return r ? `${cityName(r.a as string, locale)}–${cityName(r.b as string, locale)}` : id;
  };

  const lineText = (e: LogEntry): string => {
    const seat = seatOf(snapshot, e.playerId);
    const name =
      e.playerId === null
        ? ''
        : nameOf({ id: e.playerId, seat: seat ?? 0, isMe: e.playerId === me });
    switch (e.kind) {
      case 'gameStarted':
        return t('log.gameStarted');
      case 'gameEnded':
        return t('log.gameEnded');
      case 'turnStarted':
        return t('log.turnStarted', { name });
      case 'routeClaimed':
        return t('log.routeClaimed', {
          name,
          route: routeName(String(e.data.routeId)),
          points: e.data.points,
        });
      case 'stationBuilt':
        return t('log.stationBuilt', { name, city: cityName(String(e.data.cityId), locale) });
      case 'tunnelRevealed':
        return t('log.tunnelRevealed', { name, route: routeName(String(e.data.routeId)) });
      case 'tunnelCommitted':
        return t('log.tunnelCommitted', { name, route: routeName(String(e.data.routeId)) });
      case 'tunnelAborted':
        return t('log.tunnelAborted', { name, route: routeName(String(e.data.routeId)) });
      case 'drewBlind':
        return t('log.drewBlind', { name });
      case 'tookFaceup':
        return t('log.tookFaceup', { name });
      case 'ticketsKept':
        return t('log.ticketsKept', { name, count: Number(e.data.count) });
      case 'passed':
        return t('log.passed', { name });
      case 'endgame':
        return t('log.endgame', { turns: e.data.turns });
    }
  };

  return (
    <section className="log-panel">
      <div className="tray-head">
        <h4>{t('log.heading')}</h4>
      </div>
      <div className="log-list" ref={listRef}>
        {entries.length === 0 ? (
          <p className="log-empty">{t('log.empty')}</p>
        ) : (
          entries.map((e) => {
            const seat = seatOf(snapshot, e.playerId);
            const color = e.data.color as CardColor | null | undefined;
            return (
              <div key={e.id} className={`log-line log-${e.importance}`}>
                {seat !== null && (
                  <span
                    className="log-dot"
                    style={{ background: SEAT_COLORS[seat % 5] ?? '#888' }}
                    aria-hidden
                  />
                )}
                <span className="log-text">{lineText(e)}</span>
                {e.kind === 'tookFaceup' && color && (
                  <span
                    className="log-chip"
                    style={{ background: CARD_COLOR_TOKENS[color].hex }}
                    title={CARD_COLOR_TOKENS[color].nameZh}
                    aria-hidden
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
