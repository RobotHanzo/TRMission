// The visual glossary: standalone renders of real game components for the coachmark. Each reuses
// the exact board/card classes so it looks identical to the live game and can never drift.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { TRAIN_COLORS, type CardColor, SCORING_TABLE } from '@trm/shared';
import { mapCssVars } from '@trm/map-data';
import { TrainCarCard } from '../../components/TrainCarCard';
import { TicketCard } from '../../components/TicketCard';
import { RouteShape, FerryLocoGradientDef } from '../../components/RouteShape';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useUi } from '../../store/ui';
import { cityName } from '../../game/content';
import { straightRouteGeometry, STRAIGHT_PITCH } from '../../game/routeGeometry';
import { SEAT_COLORS, CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../theme/colors';
import type { SpecimenSpec } from './types';

const CARD_W = 56;
/** Every usable train colour the game actually has (8) plus the wild rainbow locomotive. */
const STATION_PALETTE = [...TRAIN_COLORS, 'LOCOMOTIVE'] as CardColor[];

// Board-faithful specimen geometry. The route is built by the SAME `straightRouteGeometry` +
// `RouteShape` the live map uses, and `--inv-scale` is pinned to the map's default track weight, so
// the cars, roadbed, ties and pips all come out at their REAL on-board proportions and can't drift
// from the map. A fixed viewBox (sized for the widest 4-car tunnel) keeps every variant's cars the
// same size; the CSS just scales the whole SVG up.
const SPEC_INV = 0.55; // the board's ~1/zoom default weight (a touch firm so it stays crisp when small)
const SPEC_W = 13; // viewBox width — fits the 4-car tunnel with lead-in
const SPEC_H = 4.2; // viewBox height — fits the tunnel glow and the twin double-track
const SPEC_CY = SPEC_H / 2;
// Half the gap between a double route's two parallel tracks — the same 1.35-board-unit perp nudge the
// board applies (counter-scaled), so the twin tracks sit as snug here as on the map.
const SPEC_DOUBLE_GAP = 1.35 * SPEC_INV;

/** One straight specimen track centred at `cy`, drawn through the shared board `RouteShape`. */
function SpecTrack({
  variant,
  cy,
  fill,
  count,
}: {
  variant: 'rail' | 'ferry' | 'tunnel' | 'broken';
  cy: number;
  fill: string;
  count: number;
}) {
  const isTunnel = variant === 'tunnel';
  const isFerry = variant === 'ferry';
  const isBroken = variant === 'broken';
  const cls = 'route' + (isTunnel ? ' tunnel' : isFerry ? ' ferry' : isBroken ? ' broken' : '');
  return (
    <g className={cls}>
      <RouteShape
        geometry={straightRouteGeometry(count, isTunnel, SPEC_W / 2, cy)}
        isTunnel={isTunnel}
        isFerry={isFerry}
        ferryLocos={isFerry ? 1 : 0}
        length={count}
        fill={fill}
        brokenCarriages={isBroken ? 2 : 0}
      />
    </g>
  );
}

/** A short straight route drawn with the live board components. A `double` renders as the board's
 *  twin track: two full parallel routes in DIFFERENT liveries (never one faded out), sitting snug. A
 *  ferry's pips are the neutral grey of a GRAY route — exactly as the map paints an unclaimed ferry. */
export function RouteSpecimen({
  variant,
}: {
  variant: 'rail' | 'ferry' | 'tunnel' | 'double' | 'broken';
}) {
  const count = variant === 'tunnel' ? 4 : 3;
  return (
    <svg
      className="tut-route-specimen"
      viewBox={`0 0 ${SPEC_W} ${SPEC_H}`}
      data-testid="tut-specimen"
      style={{ ...mapCssVars(), ['--inv-scale' as string]: String(SPEC_INV) }}
      role="img"
    >
      {variant === 'ferry' && <FerryLocoGradientDef />}
      {variant === 'double' ? (
        <>
          <SpecTrack
            variant="rail"
            cy={SPEC_CY - SPEC_DOUBLE_GAP}
            fill={CARD_COLOR_TOKENS.ORANGE.hex}
            count={count}
          />
          <SpecTrack
            variant="rail"
            cy={SPEC_CY + SPEC_DOUBLE_GAP}
            fill={CARD_COLOR_TOKENS.BLUE.hex}
            count={count}
          />
        </>
      ) : (
        <SpecTrack
          variant={variant}
          cy={SPEC_CY}
          fill={variant === 'ferry' ? GRAY_TOKEN.hex : CARD_COLOR_TOKENS.BLUE.hex}
          count={count}
        />
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

/** Stations shown the way they read on the board: a row of city markers, each with its name below
 *  the circle. One carries a seat-coloured station + a "built" badge; the others sit empty, so the
 *  difference between a city with and without a station is unmistakable. */
export function StationSpecimen() {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const builtFill = SEAT_COLORS[0];
  const cities: Array<{ id: string; built: boolean }> = [
    { id: 'taipei', built: true },
    { id: 'hsinchu', built: false },
    { id: 'zhunan', built: false },
  ];
  return (
    <div className="tut-station-row" data-testid="tut-specimen">
      {cities.map(({ id, built }) => (
        <div className={built ? 'tut-station-chip is-built' : 'tut-station-chip'} key={id}>
          <svg className="tut-station-marker" viewBox="0 0 40 40" role="img" aria-hidden>
            <circle className="tut-station-city" cx={20} cy={20} r={9} />
            {built && (
              <circle
                className="tut-station-built-dot"
                cx={20}
                cy={20}
                r={5.5}
                style={{ fill: builtFill }}
              />
            )}
          </svg>
          <span className="tut-station-name">{cityName(id, locale)}</span>
          {built ? (
            <span className="tut-station-built">
              <Check size={11} /> {t('tutorial.stations.specimenBuilt')}
            </span>
          ) : (
            <span className="tut-station-empty">{t('tutorial.stations.specimenEmpty')}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** One station-payment card whose colour cross-fades through the palette (a station is paid in a
 *  single colour, so all the cards in the cost table cycle together). Two stacked layers give the
 *  gradual fade; `idx` (shared by every card) drives the remount that re-triggers it. */
function CyclingCard({
  idx,
  size,
  count,
  showCount = true,
}: {
  idx: number;
  size: number;
  count?: number;
  showCount?: boolean;
}) {
  const len = STATION_PALETTE.length;
  const cur = STATION_PALETTE[((idx % len) + len) % len]!;
  const prev = STATION_PALETTE[(((idx - 1) % len) + len) % len]!;
  // Spread `count` only when present: TrainCarCard's `count?` rejects an explicit `undefined`
  // under exactOptionalPropertyTypes.
  const countProp = count !== undefined ? { count } : {};
  return (
    <span className="tut-cost-card">
      <span className="tut-cost-card-layer is-prev" key={`p${idx}`}>
        <TrainCarCard
          color={prev}
          size={size}
          showGlyph={false}
          showCount={showCount}
          {...countProp}
        />
      </span>
      <span className="tut-cost-card-layer is-cur" key={`c${idx}`}>
        <TrainCarCard
          color={cur}
          size={size}
          showGlyph={false}
          showCount={showCount}
          {...countProp}
        />
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

/** A mini straight railway of `len` car-slots in `fill`, drawn with the live board components —
 *  reusing the map's board-faithful geometry so the cars match the map (and the route chapter).
 *  Display px/board-unit is fixed so every row's cars are the same size; longer routes are simply
 *  wider. */
const CLAIM_TRACK_PX = 14; // display px per board unit
function ClaimTrack({ len, fill }: { len: number; fill: string }) {
  const pad = 0.9;
  const w = len * STRAIGHT_PITCH + pad * 2;
  const h = 3;
  return (
    <svg
      className="tut-claim-track"
      viewBox={`0 0 ${w.toFixed(2)} ${h}`}
      width={w * CLAIM_TRACK_PX}
      height={h * CLAIM_TRACK_PX}
      style={{ ...mapCssVars(), ['--inv-scale' as string]: String(SPEC_INV) }}
      role="img"
      aria-hidden
    >
      <g className="route">
        <RouteShape
          geometry={straightRouteGeometry(len, false, w / 2, h / 2)}
          isTunnel={false}
          isFerry={false}
          ferryLocos={0}
          length={len}
          fill={fill}
        />
      </g>
    </svg>
  );
}

/** Each row of this discriminated list is one railway → its payment. */
type ClaimRow = { kind: 'color'; color: CardColor; len: number } | { kind: 'gray'; len: number };
const CLAIM_ROWS: ClaimRow[] = [
  { kind: 'color', color: 'RED', len: 2 },
  { kind: 'color', color: 'BLUE', len: 4 },
  { kind: 'gray', len: 3 },
];
const CLAIM_CARD_W = 44;
/** Neutral grey for a GRAY (any-colour) route's track. */
const GRAY_TRACK = '#9aa0a6';

/** The claim-cost reference: varying-length railways each pointing to the single card that pays for
 *  them. Colored routes → a static matching-colour card ("same colour as the route"); the gray route
 *  → the colour-cycling card (reused from the station chapter) meaning "any colour". The card keeps
 *  its stacked-deck look (so it reads as "several cards"), but the exact ×N count is printed BESIDE
 *  the card rather than over it, so the amount stays legible. */
export function ClaimCostSpecimen() {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setIdx((i) => i + 1), 1500);
    return () => clearInterval(id);
  }, [reduced]);
  return (
    <div className="tut-claim-cost" data-testid="tut-specimen">
      {CLAIM_ROWS.map((row, i) => (
        <div className="tut-claim-cost-row" key={i}>
          <ClaimTrack
            len={row.len}
            fill={row.kind === 'gray' ? GRAY_TRACK : CARD_COLOR_TOKENS[row.color].hex}
          />
          <span className="tut-claim-cost-arrow" aria-hidden>
            →
          </span>
          {row.kind === 'gray' ? (
            <CyclingCard idx={idx} size={CLAIM_CARD_W} count={row.len} showCount={false} />
          ) : (
            <TrainCarCard
              color={row.color}
              count={row.len}
              size={CLAIM_CARD_W}
              showGlyph={false}
              showCount={false}
            />
          )}
          <span className="tut-claim-cost-count">×{row.len}</span>
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
    case 'claim-cost':
      return <ClaimCostSpecimen />;
    case 'ticket':
      return <TicketSpecimen id={spec.id} />;
  }
}
