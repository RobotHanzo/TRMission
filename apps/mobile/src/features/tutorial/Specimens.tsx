// The visual glossary: standalone renders of real game components for the coachmark. Each reuses
// P2's live components/painters — TrainCarCard, TicketCard, and the board's RouteLayer over the
// same straightRouteGeometry — so it looks identical to the live game and can never drift (the
// invariant the web version holds with shared CSS classes). Track colours go through RouteLayer's
// own colour-key lookup, so even the glossary's greys are the board's greys.
import { createContext, useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Canvas, Group } from '@shopify/react-native-skia';
import { Check } from 'lucide-react-native';
import { TRAIN_COLORS, SCORING_TABLE, type CardColor } from '@trm/shared';
import { MAP_PALETTE_LIGHT } from '@trm/map-data';
import { TrainCarCard } from '../../components/game/TrainCarCard';
import { TicketCard } from '../../components/game/TicketCard';
import { RouteLayer } from '../../board/RouteLayer';
import { buildRouteRenderModel, type RouteRenderModel } from '../../board/scenePaths';
import { straightRouteGeometry, STRAIGHT_PITCH } from '../../game/routeGeometry';
import { cityName } from '../../game/content';
import { SEAT_COLORS } from '../../theme/colors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useUi } from '../../store/ui';
import type { SpecimenSpec } from './types';

const CARD_W = 56;
/** Every usable train colour the game actually has (8) plus the wild rainbow locomotive. */
const STATION_PALETTE = [...TRAIN_COLORS, 'LOCOMOTIVE'] as CardColor[];
const CYCLE_MS = 1500; // palette cross-cycle cadence (web parity)

// Board-faithful specimen geometry (the web file's constants, verbatim). The track is built by the
// SAME straightRouteGeometry + RouteLayer the live map uses, with `inv` pinned to the map's default
// track weight, so cars, roadbed, ties and pips come out at their REAL on-board proportions.
const SPEC_INV = 0.55; // the board's ~1/zoom default weight (a touch firm so it stays crisp small)
const SPEC_W = 13; // canvas width in board units — fits the 4-car tunnel with lead-in
const SPEC_H = 4.2; // canvas height in board units — fits the tunnel glow and the twin double-track
const SPEC_CY = SPEC_H / 2;
// Half the gap between a double route's two parallel tracks — the board's 1.35-board-unit perp
// nudge (counter-scaled), so the twin tracks sit as snug here as on the map.
const SPEC_DOUBLE_GAP = 1.35 * SPEC_INV;
/** Display px per board unit for the route glossary (the web scales its SVG with CSS instead). */
const SPEC_PX = 20;

// The available inner width of the specimen box (measured by the `Specimen` wrapper). A Skia canvas
// has a fixed pixel size, unlike the web's CSS-scaled SVG, so on a narrow coachmark the widest
// tracks (the 4-car tunnel) would overflow the card. Canvases counter-scale to fit this width.
const SpecimenWidthCtx = createContext<number | undefined>(undefined);

/** px-per-board-unit for a canvas `boardW` units wide that must fit within the measured specimen
 *  width, less any sibling `reserve` (a compare-row label, a claim row's arrow/card/count). Falls
 *  back to the natural size before measurement / under jest, so nothing shrinks unexpectedly. */
function fitPx(natural: number, boardW: number, avail: number | undefined, reserve = 0): number {
  if (avail == null) return natural;
  return Math.max(1, Math.min(natural, (avail - reserve) / boardW));
}

/** One synthetic straight route rendered through the board's own model builder + painter. */
function trackModel(
  id: string,
  color: string,
  count: number,
  opts: { tunnel?: boolean; ferry?: boolean; broken?: number },
  cx: number,
  cy: number,
): RouteRenderModel[] {
  return buildRouteRenderModel(
    [
      {
        id,
        a: '',
        b: '',
        color,
        length: count,
        isTunnel: !!opts.tunnel,
        ferryLocos: opts.ferry ? 1 : 0,
        brokenCarriages: opts.broken ?? 0,
      },
    ],
    new Map([[id, straightRouteGeometry(count, !!opts.tunnel, cx, cy)]]),
  );
}

/** The bare track canvas (no testID) shared by RouteSpecimen and the compare rows. A `double`
 *  renders as the board's twin track: two full parallel routes in DIFFERENT liveries (never one
 *  faded out). A ferry's pips take the neutral GRAY key — exactly as the map paints an unclaimed
 *  ferry. */
function RouteCanvas({
  variant,
  reserve = 0,
}: {
  variant: 'rail' | 'ferry' | 'tunnel' | 'double' | 'broken';
  reserve?: number;
}) {
  const count = variant === 'tunnel' ? 4 : 3;
  const px = fitPx(SPEC_PX, SPEC_W, useContext(SpecimenWidthCtx), reserve);
  const models =
    variant === 'double'
      ? [
          ...trackModel('spec-a', 'ORANGE', count, {}, SPEC_W / 2, SPEC_CY - SPEC_DOUBLE_GAP),
          ...trackModel('spec-b', 'BLUE', count, {}, SPEC_W / 2, SPEC_CY + SPEC_DOUBLE_GAP),
        ]
      : variant === 'ferry'
        ? trackModel('spec', 'GRAY', count, { ferry: true }, SPEC_W / 2, SPEC_CY)
        : variant === 'broken'
          ? trackModel('spec', 'BLUE', count, { broken: 2 }, SPEC_W / 2, SPEC_CY)
          : trackModel('spec', 'BLUE', count, { tunnel: variant === 'tunnel' }, SPEC_W / 2, SPEC_CY);
  return (
    <Canvas style={{ width: SPEC_W * px, height: SPEC_H * px }}>
      <Group transform={[{ scale: px }]}>
        <RouteLayer model={models} inv={SPEC_INV} />
      </Group>
    </Canvas>
  );
}

export function RouteSpecimen({
  variant,
}: {
  variant: 'rail' | 'ferry' | 'tunnel' | 'double' | 'broken';
}) {
  return (
    <View testID="tut-specimen" style={styles.centered}>
      <RouteCanvas variant={variant} />
    </View>
  );
}

// Each compare row reserves its fixed label column (64) + the row gap (8) so the track fits beside it.
const COMPARE_RESERVE = 64 + 8;

export function RouteCompareSpecimen() {
  const { t } = useTranslation();
  const rows: Array<['rail' | 'ferry' | 'tunnel', string]> = [
    ['rail', t('tutorial.glossary.rail')],
    ['ferry', t('tutorial.glossary.ferry')],
    ['tunnel', t('tutorial.glossary.tunnel')],
  ];
  return (
    <View testID="tut-specimen" style={styles.compare}>
      {rows.map(([variant, label]) => (
        <View style={styles.compareRow} key={variant}>
          <Text style={styles.compareLabel}>{label}</Text>
          <RouteCanvas variant={variant} reserve={COMPARE_RESERVE} />
        </View>
      ))}
    </View>
  );
}

export function CardRowSpecimen() {
  const colors: CardColor[] = [...TRAIN_COLORS, 'LOCOMOTIVE'];
  return (
    <View testID="tut-specimen" style={styles.cardRow}>
      {colors.map((c) => (
        <TrainCarCard key={c} color={c} size={CARD_W} showGlyph />
      ))}
    </View>
  );
}

export function LocoCardSpecimen() {
  return (
    <View testID="tut-specimen" style={styles.centered}>
      <TrainCarCard color="LOCOMOTIVE" size={96} showGlyph />
    </View>
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
    <View testID="tut-specimen" style={styles.stationRow}>
      {cities.map(({ id, built }) => (
        <View style={styles.stationChip} key={id}>
          <View style={styles.stationMarker}>
            {built && <View style={[styles.stationBuiltDot, { backgroundColor: builtFill }]} />}
          </View>
          <Text style={styles.stationName}>{cityName(id, locale)}</Text>
          {built ? (
            <View style={styles.stationBadge}>
              <Check size={11} color="#2e7d32" />
              <Text style={styles.stationBuiltText}>{t('tutorial.stations.specimenBuilt')}</Text>
            </View>
          ) : (
            <Text style={styles.stationEmptyText}>{t('tutorial.stations.specimenEmpty')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

/** One station-payment card cycling through the palette (a station is paid in a single colour, so
 *  every card in a cost table cycles together on the shared `idx`). The web cross-fades two CSS
 *  layers; natively the card simply swaps — static under reduced motion either way. */
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
  // Spread `count` only when present: TrainCarCard's `count?` rejects an explicit `undefined`
  // under exactOptionalPropertyTypes.
  const countProp = count !== undefined ? { count } : {};
  return (
    <TrainCarCard color={cur} size={size} showGlyph={false} showCount={showCount} {...countProp} />
  );
}

/** The station-cost reference: row 1 = 1 card, row 2 = 2, row 3 = 3 — all of one (cycling) colour. */
export function StationCostSpecimen() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [reduced]);
  return (
    <View testID="tut-specimen" style={styles.costTable}>
      {[1, 2, 3].map((n) => (
        <View style={styles.costRow} key={n}>
          <Text style={styles.costLabel}>{t(`tutorial.stations.cost${n}`)}</Text>
          <View style={styles.costCards}>
            {Array.from({ length: n }, (_, i) => (
              <CyclingCard key={i} idx={idx} size={30} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The route-length → points reference (a row per length: that many car-squares, then the points it
 * scores). Reads the live SCORING_TABLE so it can never drift from the rules.
 */
export function ScoreTableSpecimen() {
  const rows = (Object.entries(SCORING_TABLE) as [string, number][])
    .map(([len, pts]) => [Number(len), pts] as const)
    .sort((a, b) => a[0] - b[0]);
  return (
    <View testID="tut-specimen" style={styles.scoreTable}>
      {rows.map(([len, pts]) => (
        <View style={styles.scoreRow} key={len}>
          <View style={styles.scoreCars}>
            {Array.from({ length: len }, (_, i) => (
              <View style={styles.scoreCar} key={i} />
            ))}
          </View>
          <Text style={styles.scorePts}>{pts}</Text>
        </View>
      ))}
    </View>
  );
}

/** A mini straight railway of `len` car-slots, drawn with the live board painter — the same
 *  board-faithful geometry as the route chapter. Display px/board-unit is fixed so every row's
 *  cars are the same size; longer routes are simply wider. */
const CLAIM_TRACK_PX = 14; // display px per board unit
// A claim row also carries an arrow, a payment card (CLAIM_CARD_W) and the ×N count — reserve that
// so the longest track (len 4) still fits the coachmark instead of pushing the row off the edge.
const CLAIM_RESERVE = 44 + 30 + 40;
function ClaimTrack({ len, color }: { len: number; color: string }) {
  const pad = 0.9;
  const w = len * STRAIGHT_PITCH + pad * 2;
  const h = 3;
  const px = fitPx(CLAIM_TRACK_PX, w, useContext(SpecimenWidthCtx), CLAIM_RESERVE);
  const models = trackModel(`claim-${color}-${len}`, color, len, {}, w / 2, h / 2);
  return (
    <Canvas style={{ width: w * px, height: h * px }}>
      <Group transform={[{ scale: px }]}>
        <RouteLayer model={models} inv={SPEC_INV} />
      </Group>
    </Canvas>
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

/** The claim-cost reference: varying-length railways each pointing to the single card that pays
 *  for them. Coloured routes → a static matching-colour card; the gray route → the colour-cycling
 *  card (reused from the station chapter) meaning "any colour". The exact ×N count is printed
 *  BESIDE the card so the amount stays legible. */
export function ClaimCostSpecimen() {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [reduced]);
  return (
    <View testID="tut-specimen" style={styles.claimTable}>
      {CLAIM_ROWS.map((row, i) => (
        <View style={styles.claimRow} key={i}>
          <ClaimTrack len={row.len} color={row.kind === 'gray' ? 'GRAY' : row.color} />
          <Text style={styles.claimArrow}>→</Text>
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
          <Text style={styles.claimCount}>×{row.len}</Text>
        </View>
      ))}
    </View>
  );
}

export function TicketSpecimen({ id }: { id: string }) {
  return (
    <View testID="tut-specimen" style={styles.centered}>
      <TicketCard ticketId={id} />
    </View>
  );
}

function renderSpecimen(spec: SpecimenSpec) {
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

export function Specimen({ spec }: { spec: SpecimenSpec }) {
  // Measure the box the specimen is given so its fixed-size Skia canvases can counter-scale to fit
  // (the coachmark is much narrower on a phone than on a tablet). Undefined until first layout —
  // canvases fall back to their natural size until then.
  const [avail, setAvail] = useState<number | undefined>(undefined);
  return (
    <View onLayout={(e) => setAvail(e.nativeEvent.layout.width)}>
      <SpecimenWidthCtx.Provider value={avail}>{renderSpecimen(spec)}</SpecimenWidthCtx.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center' },
  compare: { gap: 2 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  compareLabel: { width: 64, fontSize: 12, fontWeight: '600' },
  cardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stationRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  stationChip: { alignItems: 'center', gap: 2 },
  stationMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: MAP_PALETTE_LIGHT.surface,
    borderWidth: 2,
    borderColor: MAP_PALETTE_LIGHT.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationBuiltDot: { width: 12, height: 12, borderRadius: 6 },
  stationName: { fontSize: 12, fontWeight: '600' },
  stationBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stationBuiltText: { fontSize: 10, color: '#2e7d32', fontWeight: '600' },
  stationEmptyText: { fontSize: 10, opacity: 0.55 },
  costTable: { gap: 6 },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  costLabel: { flex: 1, fontSize: 12 },
  costCards: { flexDirection: 'row', gap: 4 },
  scoreTable: { gap: 4 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreCars: { flexDirection: 'row', gap: 2, flex: 1 },
  scoreCar: { width: 11, height: 7, borderRadius: 2, backgroundColor: '#3a4149' },
  scorePts: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  claimTable: { gap: 8 },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  claimArrow: { fontSize: 14, opacity: 0.7 },
  claimCount: { fontSize: 13, fontWeight: '700' },
});
