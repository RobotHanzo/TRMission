import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine } from 'lucide-react';
import { EventPerk, type GameSnapshot } from '@trm/proto';
import { useLogStore } from '../store/log';
import { useGameStore } from '../store/game';
import { useUi } from '../store/ui';
import { usePlayerName } from '../game/playerName';
import { SEAT_COLORS, CARD_COLOR_TOKENS, LOCOMOTIVE_GRADIENT } from '../theme/colors';
import { cityName, routeById, ticketLabel } from '../game/content';
import { eventNameKey } from '../game/events';
import type { CardColor } from '@trm/shared';
import type { LogEntry } from '../game/logModel';

const BOTTOM_THRESHOLD_PX = 2;

const isAtBottom = (element: HTMLElement): boolean =>
  element.scrollHeight - element.clientHeight - element.scrollTop <= BOTTOM_THRESHOLD_PX;

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
  const followingLatestRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;

    if (followingLatestRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    // Replays and history backfills can replace or shrink the list. If that leaves the viewport
    // at the bottom, resume following even when no scroll event was emitted for the clamp.
    if (isAtBottom(el)) {
      followingLatestRef.current = true;
      setShowScrollToBottom(false);
    }
  }, [entries]);

  const handleScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    const followingLatest = isAtBottom(el);
    followingLatestRef.current = followingLatest;
    setShowScrollToBottom(!followingLatest);
  };

  const scrollToBottom = (): void => {
    const el = listRef.current;
    if (!el) return;
    followingLatestRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowScrollToBottom(false);
  };

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
      case 'playerLeft':
        return t('log.playerLeft', { name });
      case 'playerReconnected':
        return t('log.playerReconnected', { name });
      case 'botTookOver':
        return t('log.botTookOver', { name });
      case 'seatReclaimed':
        return t('log.seatReclaimed', { name });
      case 'turnStarted':
        return t('log.turnStarted', { name });
      case 'routeClaimed':
        return t('log.routeClaimed', {
          name,
          route: routeName(String(e.data.routeId)),
          points: e.data.points,
        });
      case 'brokenRailRepaired':
        return t('log.brokenRailRepaired', {
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
        return e.data.reason === 'DEADLOCK'
          ? t('log.endgameDeadlock')
          : t('log.endgame', { turns: e.data.turns });
      case 'eventAnnounced':
        return t('log.eventAnnounced', { event: t(eventNameKey(String(e.data.eventKind))) });
      case 'eventStarted':
        return t('log.eventStarted', { event: t(eventNameKey(String(e.data.eventKind))) });
      case 'eventEnded':
        return t('log.eventEnded', { event: t(eventNameKey(String(e.data.eventKind))) });
      case 'eventBonus':
        return t(`log.eventBonus.${String(e.data.reason)}`, {
          points: Number(e.data.points),
          city: e.data.cityId ? cityName(String(e.data.cityId), locale) : '',
          route: e.data.routeId ? routeName(String(e.data.routeId)) : '',
        });
      case 'eventMarkerMoved':
        return t('log.eventMarkerMoved', {
          event: t(eventNameKey(String(e.data.eventKind))),
          city: cityName(String(e.data.cityId), locale),
        });
      case 'eventNightMarketSwapped':
        return t('log.eventNightMarketSwapped', { name });
      case 'eventPerkChosen': {
        const perk = Number(e.data.perk);
        const perkName =
          perk === EventPerk.CLAIM_DISCOUNT
            ? t('events.perkClaimDiscount')
            : perk === EventPerk.DRAW_TWO
              ? t('events.perkDrawTwo')
              : t('events.perkRepairPermit');
        return t('log.eventPerkChosen', { name, perk: perkName });
      }
      case 'eventHiveResolved':
        return e.data.busted
          ? t('log.eventHiveBusted', { name })
          : t('log.eventHiveKept', { name, count: Number(e.data.keptCount) });
      case 'marketRecycled':
        return t(`log.marketRecycled.${String(e.data.reason || 'THREE_LOCOS')}`);
      case 'ticketCompleted': {
        const label = ticketLabel(String(e.data.ticketId), locale);
        return label
          ? t('log.ticketCompleted', {
              name,
              from: label.a,
              to: label.b,
              points: label.value,
            })
          : '';
      }
      case 'teamPoolPushed':
        return t('log.teamPoolPushed', { name });
      case 'teamPoolTaken':
        return t('log.teamPoolTaken', { name });
    }
  };

  return (
    <section className="log-panel">
      <div className="tray-head">
        <h4>{t('log.heading')}</h4>
      </div>
      <div className="log-list-shell">
        <div className="log-list" ref={listRef} onScroll={handleScroll}>
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
                      style={{
                        background:
                          color === 'LOCOMOTIVE'
                            ? LOCOMOTIVE_GRADIENT
                            : CARD_COLOR_TOKENS[color].hex,
                      }}
                      title={CARD_COLOR_TOKENS[color].nameZh}
                      aria-hidden
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            className="log-scroll-bottom"
            aria-label={t('log.scrollToBottom')}
            title={t('log.scrollToBottom')}
            onClick={scrollToBottom}
          >
            <ArrowDownToLine size={16} aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
