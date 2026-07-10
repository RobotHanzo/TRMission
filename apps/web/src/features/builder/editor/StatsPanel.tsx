import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, MapPin, Route, Ship, TrainFrontTunnel } from 'lucide-react';
import { TRAIN_COLORS } from '@trm/shared';
import type { RouteColor } from '@trm/shared';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../../theme/colors';
import { useEditorStore } from './store';

/** Canonical route-colour order (the 8 train colours, then GRAY) — matches the Routes stage. */
const ROUTE_COLORS: readonly RouteColor[] = [...TRAIN_COLORS, 'GRAY'];

export interface MapStats {
  stations: number;
  routes: number;
  /** Total train-car segments across every route (a length-4 route counts as 4). */
  segments: number;
  /** Segment totals per colour, canonical order, colours with zero segments omitted. Tunnel routes
   *  DO count toward their colour here (a tunnel carries a real colour) and are *also* totalled on
   *  their own in `tunnelSegments`. Ferry routes are the exception: always GRAY, they're kept out
   *  and reported only under `ferrySegments`, so GRAY's count isn't a mix of unrelated ferry
   *  mechanics. */
  segmentsByColor: { color: RouteColor; segments: number }[];
  /** Total segments across tunnel routes of any colour. These are *also* folded into their
   *  colour's `segmentsByColor` entry, so this is a supplementary view, not a disjoint bucket. */
  tunnelSegments: number;
  /** Total segments across ferry routes (always GRAY). */
  ferrySegments: number;
  shortTickets: number;
  longTickets: number;
}

export function useMapStats(): MapStats {
  const draft = useEditorStore((s) => s.draft);
  return useMemo(() => {
    const byColor = new Map<string, number>();
    let segments = 0;
    let tunnelSegments = 0;
    let ferrySegments = 0;
    for (const r of draft.routes) {
      segments += r.length;
      if (r.ferryLocos > 0) {
        // Ferries are always GRAY — kept out of the colour breakdown and reported on their own.
        ferrySegments += r.length;
      } else {
        // Tunnels count toward their colour like any plain route, and are *also* totalled on their
        // own Tunnel chip below.
        if (r.isTunnel) tunnelSegments += r.length;
        byColor.set(r.color, (byColor.get(r.color) ?? 0) + r.length);
      }
    }
    const segmentsByColor = ROUTE_COLORS.filter((c) => (byColor.get(c) ?? 0) > 0).map((color) => ({
      color,
      segments: byColor.get(color) ?? 0,
    }));
    return {
      stations: draft.cities.length,
      routes: draft.routes.length,
      segments,
      segmentsByColor,
      tunnelSegments,
      ferrySegments,
      shortTickets: draft.tickets.filter((tk) => tk.deck === 'SHORT').length,
      longTickets: draft.tickets.filter((tk) => tk.deck === 'LONG').length,
    };
  }, [draft]);
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="row between stats-row">
      <span>{label}</span>
      <span className="stats-value">{value}</span>
    </div>
  );
}

/** A compact map-summary chip for the editor header (beside the validation panel): the station and
 *  route counts stay one glance away, and clicking drops a popover with the full breakdown —
 *  segments (total + per colour) and the short/long ticket split — mirroring ValidationPanel's
 *  drop-down-details pattern rather than a full-width bar that eats canvas height. */
export function StatsPanel() {
  const { t } = useTranslation();
  const stats = useMapStats();
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  return (
    <div className={expanded ? 'stats-panel open' : 'stats-panel'} ref={rootRef}>
      <button
        type="button"
        className="stats-toggle"
        aria-expanded={expanded}
        aria-label={t('builder.stats')}
        title={t('builder.stats')}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="stats-count" title={t('builder.statStations')}>
          <MapPin size={14} aria-hidden /> {stats.stations}
        </span>
        <span className="stats-count" title={t('builder.statRoutes')}>
          <Route size={14} aria-hidden /> {stats.routes}
        </span>
        <ChevronUp
          size={14}
          aria-hidden
          className={expanded ? 'stats-chevron' : 'stats-chevron collapsed'}
        />
      </button>
      {expanded && (
        <div className="stack stats-list">
          <StatRow label={t('builder.statStations')} value={stats.stations} />
          <StatRow label={t('builder.statRoutes')} value={stats.routes} />
          <StatRow label={t('builder.statSegments')} value={stats.segments} />
          {(stats.segmentsByColor.length > 0 ||
            stats.tunnelSegments > 0 ||
            stats.ferrySegments > 0) && (
            <>
              <span className="muted stats-sublabel">{t('builder.statSegmentsByColor')}</span>
              <div className="stats-colors">
                {stats.segmentsByColor.map(({ color, segments }) => {
                  const token = color === 'GRAY' ? GRAY_TOKEN : CARD_COLOR_TOKENS[color];
                  return (
                    <div
                      key={color}
                      className="stats-color-chip"
                      title={`${token.nameZh}: ${segments}`}
                    >
                      <span
                        className="color-swatch"
                        style={{ background: token.hex }}
                        aria-hidden
                      />
                      <span className="stats-color-name">{token.nameZh}</span>
                      <span className="stats-color-count">{segments}</span>
                    </div>
                  );
                })}
                {stats.tunnelSegments > 0 && (
                  <div
                    className="stats-color-chip"
                    title={`${t('builder.statTunnelSegments')}: ${stats.tunnelSegments}`}
                  >
                    <TrainFrontTunnel size={14} className="stats-color-icon" aria-hidden />
                    <span className="stats-color-name">{t('builder.statTunnelSegments')}</span>
                    <span className="stats-color-count">{stats.tunnelSegments}</span>
                  </div>
                )}
                {stats.ferrySegments > 0 && (
                  <div
                    className="stats-color-chip"
                    title={`${t('builder.statFerrySegments')}: ${stats.ferrySegments}`}
                  >
                    <Ship size={14} className="stats-color-icon" aria-hidden />
                    <span className="stats-color-name">{t('builder.statFerrySegments')}</span>
                    <span className="stats-color-count">{stats.ferrySegments}</span>
                  </div>
                )}
              </div>
            </>
          )}
          <StatRow label={t('builder.statShortTickets')} value={stats.shortTickets} />
          <StatRow label={t('builder.statLongTickets')} value={stats.longTickets} />
        </div>
      )}
    </div>
  );
}
