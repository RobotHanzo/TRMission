import type { GameEvent } from '@trm/proto';
import { pbToCard } from './cards';

export type Importance = 'normal' | 'highlight' | 'alert';

export type LogKind =
  | 'gameStarted'
  | 'turnStarted'
  | 'routeClaimed'
  | 'brokenRailRepaired'
  | 'stationBuilt'
  | 'tunnelRevealed'
  | 'tunnelCommitted'
  | 'tunnelAborted'
  | 'drewBlind'
  | 'tookFaceup'
  | 'ticketsKept'
  | 'ticketCompleted'
  | 'passed'
  | 'endgame'
  | 'gameEnded'
  | 'eventAnnounced'
  | 'eventStarted'
  | 'eventEnded'
  | 'eventBonus'
  | 'eventMarkerMoved'
  | 'eventNightMarketSwapped'
  | 'eventPerkChosen'
  | 'eventHiveResolved'
  | 'teamPoolPushed'
  | 'teamPoolTaken'
  | 'marketRecycled'
  | 'playerLeft'
  | 'playerReconnected'
  | 'botTookOver'
  | 'seatReclaimed';

export interface LogDatum {
  kind: LogKind;
  playerId: string | null;
  data: Record<string, unknown>;
  importance: Importance;
}

export interface LogEntry extends LogDatum {
  id: number;
}

/** A hub-originated player-connection change, never an engine event — kept in the log's own
 *  vocabulary rather than `GameEvent` since it has no deterministic engine counterpart. */
export function connectionLogDatum(playerId: string, connected: boolean): LogDatum {
  return {
    kind: connected ? 'playerReconnected' : 'playerLeft',
    playerId,
    data: {},
    importance: 'alert',
  };
}

/** A hub-originated seat-control change: the server handed a repeatedly-timing-out seat to its
 *  MEDIUM takeover bot, or the player took it back. Same posture as `connectionLogDatum` — hub
 *  bookkeeping, never an engine event. */
export function seatControlDatum(playerId: string, botControlled: boolean): LogDatum {
  return {
    kind: botControlled ? 'botTookOver' : 'seatReclaimed',
    playerId,
    data: {},
    importance: 'alert',
  };
}

/**
 * Pure projection of a delivered event batch into log rows. Names + seat colours are
 * resolved later at render (so late roster names + locale changes apply); this only
 * carries ids/counts. Ambient/noisy events (market refill, deck reshuffle, turn-ended,
 * private ticket offers, double-route lock) are omitted; a market recycle (3 face-up
 * locomotives) is notable enough to keep.
 */
export function entriesFromEvents(events: GameEvent[]): LogDatum[] {
  const out: LogDatum[] = [];
  for (const e of events) {
    const ev = e.event;
    switch (ev.case) {
      case 'gameStarted':
        out.push({ kind: 'gameStarted', playerId: null, data: {}, importance: 'normal' });
        break;
      case 'turnStarted':
        out.push({
          kind: 'turnStarted',
          playerId: ev.value.playerId,
          data: {},
          importance: 'normal',
        });
        break;
      case 'routeClaimed':
        out.push({
          kind: 'routeClaimed',
          playerId: ev.value.playerId,
          data: { routeId: ev.value.routeId, points: ev.value.pointsAwarded },
          importance: 'highlight',
        });
        break;
      case 'brokenRailRepaired':
        out.push({
          kind: 'brokenRailRepaired',
          playerId: ev.value.playerId,
          data: {
            routeId: ev.value.routeId,
            carriages: ev.value.carriages,
            points: ev.value.pointsAwarded,
          },
          importance: 'highlight',
        });
        break;
      case 'stationBuilt':
        out.push({
          kind: 'stationBuilt',
          playerId: ev.value.playerId,
          data: { cityId: ev.value.cityId },
          importance: 'highlight',
        });
        break;
      case 'tunnelRevealed':
        out.push({
          kind: 'tunnelRevealed',
          playerId: ev.value.playerId,
          data: { routeId: ev.value.routeId },
          importance: 'normal',
        });
        break;
      case 'tunnelResolved':
        out.push(
          ev.value.committed
            ? {
                kind: 'tunnelCommitted',
                playerId: ev.value.playerId,
                data: { routeId: ev.value.routeId },
                importance: 'highlight',
              }
            : {
                kind: 'tunnelAborted',
                playerId: ev.value.playerId,
                data: { routeId: ev.value.routeId },
                importance: 'normal',
              },
        );
        break;
      case 'cardDrawnBlind':
        out.push({
          kind: 'drewBlind',
          playerId: ev.value.playerId,
          data: {},
          importance: 'normal',
        });
        break;
      case 'cardTakenFaceup':
        out.push({
          kind: 'tookFaceup',
          playerId: ev.value.playerId,
          data: { color: pbToCard(ev.value.card) },
          importance: 'normal',
        });
        break;
      case 'initialTicketsKept':
      case 'ticketsKept':
        out.push({
          kind: 'ticketsKept',
          playerId: ev.value.playerId,
          data: { count: ev.value.keptCount },
          importance: 'normal',
        });
        break;
      case 'playerPassed':
        out.push({ kind: 'passed', playerId: ev.value.playerId, data: {}, importance: 'normal' });
        break;
      case 'endgameTriggered':
        out.push({
          kind: 'endgame',
          playerId: ev.value.playerId,
          data: { turns: ev.value.finalTurnsRemaining, reason: ev.value.reason || 'FINAL_TRAINS' },
          importance: 'alert',
        });
        break;
      case 'gameEnded':
        out.push({ kind: 'gameEnded', playerId: null, data: {}, importance: 'alert' });
        break;
      case 'randomEventAnnounced':
        out.push({
          kind: 'eventAnnounced',
          playerId: null,
          data: { eventKind: ev.value.info?.kind ?? '' },
          importance: 'alert',
        });
        break;
      case 'randomEventStarted':
        out.push({
          kind: 'eventStarted',
          playerId: null,
          data: { eventKind: ev.value.info?.kind ?? '' },
          importance: 'alert',
        });
        break;
      case 'randomEventEnded':
        out.push({
          kind: 'eventEnded',
          playerId: null,
          data: { eventKind: ev.value.kind },
          importance: 'normal',
        });
        break;
      case 'randomEventBonus':
        out.push({
          kind: 'eventBonus',
          playerId: ev.value.playerId || null,
          data: {
            reason: ev.value.reason,
            points: ev.value.points,
            cityId: ev.value.cityId,
            routeId: ev.value.routeId,
          },
          importance: 'highlight',
        });
        break;
      case 'eventMarkerMoved':
        out.push({
          kind: 'eventMarkerMoved',
          playerId: ev.value.playerId || null,
          data: { eventKind: ev.value.kind, cityId: ev.value.cityId },
          importance: 'highlight',
        });
        break;
      case 'eventNightMarketSwapped':
        out.push({
          kind: 'eventNightMarketSwapped',
          playerId: ev.value.playerId,
          data: {},
          importance: 'normal',
        });
        break;
      case 'eventPerkChosen':
        out.push({
          kind: 'eventPerkChosen',
          playerId: ev.value.playerId,
          data: { perk: ev.value.perk },
          importance: 'highlight',
        });
        break;
      case 'eventHiveResolved':
        out.push({
          kind: 'eventHiveResolved',
          playerId: ev.value.playerId,
          data: { busted: ev.value.busted, keptCount: ev.value.keptCount },
          importance: ev.value.busted ? 'alert' : 'highlight',
        });
        break;
      case 'ticketCompleted':
        out.push({
          kind: 'ticketCompleted',
          playerId: ev.value.playerId,
          data: { ticketId: ev.value.ticketId },
          importance: 'highlight',
        });
        break;
      // Team pool moves are public (the pool is open information), so both sides are logged.
      case 'teamPoolPushed':
        out.push({
          kind: 'teamPoolPushed',
          playerId: ev.value.playerId,
          data: { team: ev.value.team, card: ev.value.card },
          importance: 'normal',
        });
        break;
      case 'teamPoolTaken':
        out.push({
          kind: 'teamPoolTaken',
          playerId: ev.value.playerId,
          data: { team: ev.value.team, card: ev.value.card },
          importance: 'normal',
        });
        break;
      case 'marketRecycled':
        out.push({
          kind: 'marketRecycled',
          playerId: null,
          data: { reason: ev.value.reason || 'THREE_LOCOS' },
          importance: 'normal',
        });
        break;
      default:
        break; // omit the rest
    }
  }
  return out;
}
