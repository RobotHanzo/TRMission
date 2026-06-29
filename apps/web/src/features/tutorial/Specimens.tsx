// The visual glossary: standalone renders of real game components for the coachmark. Each reuses
// the exact board/card classes so it looks identical to the live game and can never drift.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { TRAIN_COLORS, type CardColor, SCORING_TABLE } from '@trm/shared';
import { TrainCarCard } from '../../components/TrainCarCard';
import { TicketCard } from '../../components/TicketCard';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { SpecimenSpec } from './types';

const CARD_W = 56;
/** Every usable train colour the game actually has (8) plus the wild rainbow locomotive. */
const STATION_PALETTE = [...TRAIN_COLORS, 'LOCOMOTIVE'] as CardColor[];

/** A short straight route drawn with the live board classes on a tiny fixed viewBox. */
export function RouteSpecimen({ variant }: { variant: 'rail' | 'ferry' | 'tunnel' | 'double' }) {
  // Geometry: a horizontal track of `count` car-slots across a 120x28 viewBox.
  const count = variant === 'tunnel' ? 4 : variant === 'ferry' ? 3 : variant === 'double' ? 2 : 3;
  const slotW = 18;
  const gap = 4;
  const totalW = count * slotW + (count - 1) * gap;
  const x0 = (120 - totalW) / 2;
  const y = 14;
  const slots = Array.from({ length: count }, (_, i) => x0 + i * (slotW + gap) + slotW / 2);
  const path = `M ${x0 - 6} ${y} L ${x0 + totalW + 6} ${y}`;
  const fill = variant === 'double' ? '#d33a2c' : '#4f7cc0';
  const locoMid = Math.floor(count / 2);

  const Track = ({ dy = 0, muted = false }: { dy?: number; muted?: boolean }) => (
    <g
      className={'route' + (variant === 'tunnel' ? ' tunnel' : variant === 'ferry' ? ' ferry' : '')}
      transform={`translate(0 ${dy})`}
      opacity={muted ? 0.4 : 1}
    >
      {variant === 'tunnel' && <path className="tunnel-bg" d={path} />}
      <path className="bed" d={path} />
      {variant === 'tunnel' &&
        slots.map((cx, i) => (
          <rect key={i} className="tunnel-tie" transform={`translate(${cx} ${y}) rotate(45)`} />
        ))}
      {variant === 'ferry' ? (
        <>
          <path className="ferry-line" d={path} />
          {slots.map((cx, i) =>
            i === locoMid ? (
              <rect
                key={i}
                className="slot ferry-loco"
                x={-slotW / 2}
                width={slotW}
                fill="#888"
                transform={`translate(${cx} ${y})`}
              />
            ) : (
              <circle key={i} className="ferry-pip" cx={cx} cy={y} fill={fill} />
            ),
          )}
        </>
      ) : (
        slots.map((cx, i) => (
          <rect
            key={i}
            className="slot"
            x={-slotW / 2}
            width={slotW}
            fill={muted ? '#9aa0a6' : fill}
            transform={`translate(${cx} ${y})`}
          />
        ))
      )}
    </g>
  );

  return (
    <svg
      className="tut-route-specimen"
      viewBox="0 0 120 28"
      data-testid="tut-specimen"
      style={{ ['--inv-scale' as string]: '1' }}
      role="img"
    >
      {variant === 'double' ? (
        <>
          <Track dy={-5} />
          <Track dy={5} muted />
        </>
      ) : (
        <Track />
      )}
    </svg>
  );
}

export function RouteCompareSpecimen() {
  const { t } = useTranslation();
  const rows: Array<['rail' | 'ferry' | 'tunnel', string]> = [
    ['rail', t('tutorial.glossary.rail')],
    ['ferry', t('tutorial.glossary.ferry')],
    ['tunnel', t('tutorial.glossary.tunnel')],
  ];
  return (
    <div className="tut-route-compare" data-testid="tut-specimen">
      {rows.map(([variant, label]) => (
        <div className="tut-route-compare-row" key={variant}>
          <span className="tut-route-compare-label">{label}</span>
          <RouteSpecimen variant={variant} />
        </div>
      ))}
    </div>
  );
}

export function CardRowSpecimen() {
  const colors: CardColor[] = [...TRAIN_COLORS, 'LOCOMOTIVE'];
  return (
    <div className="tut-card-row" data-testid="tut-specimen">
      {colors.map((c) => (
        <TrainCarCard key={c} color={c} size={CARD_W} showGlyph />
      ))}
    </div>
  );
}

export function LocoCardSpecimen() {
  return (
    <div className="tut-loco-card" data-testid="tut-specimen">
      <TrainCarCard color="LOCOMOTIVE" size={96} showGlyph />
    </div>
  );
}

/** A built station shown the way it reads on the board: a city marker with a seat-coloured station
 *  on it, the city's name, and a "built" badge so its claimed state is unmistakable. */
export function StationSpecimen() {
  const { t } = useTranslation();
  return (
    <div className="tut-station-card" data-testid="tut-specimen">
      <svg className="tut-station-marker" viewBox="0 0 48 48" role="img" aria-hidden>
        <circle className="tut-station-city" cx={24} cy={24} r={10} />
        <circle className="tut-station-built-dot" cx={24} cy={24} r={6} />
      </svg>
      <div className="tut-station-meta">
        <span className="tut-station-name">{t('tutorial.stations.specimenName')}</span>
        <span className="tut-station-built">
          <Check size={13} /> {t('tutorial.stations.specimenBuilt')}
        </span>
      </div>
    </div>
  );
}

/** One station-payment card whose colour cross-fades through the palette (a station is paid in a
 *  single colour, so all the cards in the cost table cycle together). Two stacked layers give the
 *  gradual fade; `idx` (shared by every card) drives the remount that re-triggers it. */
function CyclingCard({ idx, size }: { idx: number; size: number }) {
  const len = STATION_PALETTE.length;
  const cur = STATION_PALETTE[((idx % len) + len) % len]!;
  const prev = STATION_PALETTE[(((idx - 1) % len) + len) % len]!;
  return (
    <span className="tut-cost-card">
      <span className="tut-cost-card-layer is-prev" key={`p${idx}`}>
        <TrainCarCard color={prev} size={size} showGlyph={false} />
      </span>
      <span className="tut-cost-card-layer is-cur" key={`c${idx}`}>
        <TrainCarCard color={cur} size={size} showGlyph={false} />
      </span>
    </span>
  );
}

/** The station-cost reference: row 1 = 1 card, row 2 = 2, row 3 = 3 — all of one (cycling) colour. */
export function StationCostSpecimen() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setIdx((i) => i + 1), 1500);
    return () => clearInterval(id);
  }, [reduced]);
  return (
    <div className="tut-cost-table" data-testid="tut-specimen">
      {[1, 2, 3].map((n) => (
        <div className="tut-cost-row" key={n}>
          <span className="tut-cost-label">{t(`tutorial.stations.cost${n}`)}</span>
          <span className="tut-cost-cards">
            {Array.from({ length: n }, (_, i) => (
              <CyclingCard key={i} idx={idx} size={30} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The route-length → points reference, drawn as a compact card (a row per length: that many train
 * cars, then the points it scores). Reads the live SCORING_TABLE so it can never drift from the rules.
 */
export function ScoreTableSpecimen() {
  const rows = (Object.entries(SCORING_TABLE) as [string, number][])
    .map(([len, pts]) => [Number(len), pts] as const)
    .sort((a, b) => a[0] - b[0]);
  return (
    <div className="tut-score-table" data-testid="tut-specimen">
      {rows.map(([len, pts]) => (
        <div className="tut-score-row" key={len}>
          <span className="tut-score-cars" aria-hidden>
            {Array.from({ length: len }, (_, i) => (
              <span className="tut-score-car" key={i} />
            ))}
          </span>
          <span className="tut-score-pts">{pts}</span>
        </div>
      ))}
    </div>
  );
}

export function TicketSpecimen({ id }: { id: string }) {
  return (
    <div className="tut-ticket-specimen" data-testid="tut-specimen">
      <TicketCard ticketId={id} />
    </div>
  );
}

export function Specimen({ spec }: { spec: SpecimenSpec }) {
  switch (spec.kind) {
    case 'routes-compare':
      return <RouteCompareSpecimen />;
    case 'route':
      return <RouteSpecimen variant={spec.variant} />;
    case 'card-row':
      return <CardRowSpecimen />;
    case 'loco-card':
      return <LocoCardSpecimen />;
    case 'station':
      return <StationSpecimen />;
    case 'station-cost':
      return <StationCostSpecimen />;
    case 'score-table':
      return <ScoreTableSpecimen />;
    case 'ticket':
      return <TicketSpecimen id={spec.id} />;
  }
}
