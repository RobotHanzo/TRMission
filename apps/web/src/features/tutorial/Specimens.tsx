// The visual glossary: standalone renders of real game components for the coachmark. Each reuses
// the exact board/card classes so it looks identical to the live game and can never drift.
import { useTranslation } from 'react-i18next';
import { TRAIN_COLORS, type CardColor } from '@trm/shared';
import { TrainCarCard } from '../../components/TrainCarCard';
import { TicketCard } from '../../components/TicketCard';
import type { SpecimenSpec } from './types';

const CARD_W = 56;

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

export function StationSpecimen() {
  return (
    <svg
      className="tut-station-specimen"
      viewBox="0 0 48 48"
      data-testid="tut-specimen"
      style={{ ['--marker-scale' as string]: '1' }}
      role="img"
    >
      <circle className="city-dot" cx={24} cy={24} r={4} />
      <circle className="station" cx={24} cy={24} style={{ fill: '#2b6cb0' }} />
    </svg>
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
    case 'station':
      return <StationSpecimen />;
    case 'ticket':
      return <TicketSpecimen id={spec.id} />;
  }
}
