// The rail network — one Skia subtree per route, a faithful port of the web RouteShape.tsx + the
// MapScene route branch (apps/web/src/components/{RouteShape,MapScene}.tsx) drawn with the shared
// MAP_DIMS/MAP_INKS tokens (the same numbers game.css resolves through its --m-* vars, so the
// mobile board can never drift from the web board). Stack per route:
//   tunnel glint → paper roadbed → ties / ferry pips / car slots → colour-blind chip.
// (The claim-glow bloom is a LIVE overlay in MapSceneSkia now — this layer is recorded into the
// cached static Picture and must stay animation-free.)
// Across-track thicknesses counter-scale by `inv` (web --inv-scale) so the network keeps a constant
// on-screen weight; along-path positions/lengths are map-bound (from the geometry).
import { Fragment } from 'react';
import {
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Path,
  Rect,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { MAP_DIMS, MAP_INKS, MAP_PALETTE_LIGHT, LIVERY_COLORS } from '@trm/map-data';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, seatColor } from '../theme/colors';
import { BoardText } from './skiaText';
import { ferryLocoBlock, type RouteRenderModel } from './scenePaths';
import type { RouteOwnership } from './MapSceneSkia';

const D = MAP_DIMS;
const PALETTE = MAP_PALETTE_LIGHT;
const DEG = Math.PI / 180;
/** Muted grey for a locked (unclaimable double-sibling) route — mirrors web MapScene.tsx. */
const LOCKED_GREY = '#9aa0a6';
/** The severed-track bolt at a broken rail's midpoint (web RouteShape.tsx `.break-mark`): the
 *  same path, authored centred on (0,0) in board units, counter-scaled in place like the glyph. */
const BREAK_MARK = Skia.Path.MakeFromSVGString(
  'M -1.7 -0.4 L -0.5 -0.75 L -0.05 0.05 L 1.1 -0.55 L 1.7 0.4 L 0.45 0.7 L 0 -0.05 L -1.15 0.55 Z',
);
const BREAK_MARK_FILL = '#c5221f';

const colorOf = (rc: string): string =>
  rc === 'GRAY'
    ? GRAY_TOKEN.hex
    : (CARD_COLOR_TOKENS[rc as keyof typeof CARD_COLOR_TOKENS]?.hex ?? '#888');
const glyphOf = (rc: string): string =>
  rc === 'GRAY'
    ? GRAY_TOKEN.glyph
    : (CARD_COLOR_TOKENS[rc as keyof typeof CARD_COLOR_TOKENS]?.glyph ?? GRAY_TOKEN.glyph);

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const v =
    s.length === 3
      ? s
          .split('')
          .map((c) => c + c)
          .join('')
      : s;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
/** sRGB blend a→b by t (the owned route's roadbed wash = CSS `color-mix(in srgb, seat 50%, surface)`). */
function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const m = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t);
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`;
}

export interface RouteLayerProps {
  model: readonly RouteRenderModel[];
  owned?: ReadonlyMap<string, RouteOwnership> | undefined;
  colorBlind?: boolean | undefined;
  /** Draw required-loco rainbow pips on unclaimed ferries (default true). */
  showFerryLocos?: boolean | undefined;
  /** Broken-rail routes the snapshot reports repaired (client-core `brokenRailMap` keys): they
   *  render as normal track again. Omitted ⇒ every broken route shows its break. */
  repairedRoutes?: ReadonlySet<string> | undefined;
  /** Track-weight counter-scale (web --inv-scale). */
  inv: number;
}

export function RouteLayer({
  model,
  owned,
  colorBlind,
  showFerryLocos = true,
  repairedRoutes,
  inv,
}: RouteLayerProps) {
  return (
    <>
      {model.map((m) => {
        const o = owned?.get(m.id);
        const isOwned = !!o;
        // Unclaimed → route colour; claimed → owner's seat colour; locked → muted grey.
        const fill =
          o?.ownerSeat !== undefined
            ? seatColor(o.ownerSeat)
            : o?.locked
              ? LOCKED_GREY
              : colorOf(m.color);
        const carOpacity = o?.locked ? 0.45 : 1;
        // A claimed route washes its roadbed with 50% of the owner's seat colour; others stay paper.
        const bedColor =
          o?.ownerSeat !== undefined
            ? mixHex(seatColor(o.ownerSeat), PALETTE.surface, 0.5)
            : PALETTE.surface;
        const bedW = (isOwned ? D.bedOwnedW : D.bedW) * inv;
        const slotStrokeW = (isOwned ? D.slotOwnedStrokeW : D.slotStrokeW) * inv;
        const slotH = D.slotH * inv;
        const slotRx = D.slotRx * inv;
        // Once owned, ferry pips take the owner's colour (no rainbow); the backdrop hides them too.
        const ferryLocos = isOwned || showFerryLocos === false ? 0 : m.ferryLocos;
        const loco = ferryLocoBlock(m.length, ferryLocos);
        // A broken rail (斷軌) shows its break until the snapshot reports it repaired (or it is
        // owned) — web MapScene's `brokenNow`. The damaged block is centred like the ferry locos.
        const brokenNow =
          m.brokenCarriages > 0 && !o && !(repairedRoutes?.has(m.id) ?? false);
        const broken = ferryLocoBlock(m.length, brokenNow ? m.brokenCarriages : 0);

        return (
          <Group
            key={m.id}
            transform={[{ translateX: m.perp.x * inv }, { translateY: m.perp.y * inv }]}
          >
            {m.isTunnel && (
              <Path
                path={m.bed}
                style="stroke"
                strokeWidth={D.tunnelBgW * inv}
                strokeCap="round"
                color={MAP_INKS.tunnelBg}
                opacity={MAP_INKS.tunnelBgOpacity}
              />
            )}
            <Path
              path={m.bed}
              style="stroke"
              strokeWidth={bedW}
              strokeCap="round"
              color={bedColor}
              opacity={isOwned ? 1 : D.bedOpacity}
            />

            {m.isTunnel &&
              m.ties.map((t, i) => (
                <Group
                  key={`tie${i}`}
                  transform={[
                    { translateX: t.x },
                    { translateY: t.y },
                    { rotate: (t.angle + 45) * DEG },
                  ]}
                >
                  <Rect
                    x={(-D.tieW / 2) * inv}
                    y={(-D.tieH / 2) * inv}
                    width={D.tieW * inv}
                    height={D.tieH * inv}
                    color={MAP_INKS.tie}
                    opacity={MAP_INKS.tieOpacity}
                  />
                </Group>
              ))}

            {m.isFerry ? (
              <>
                <Path
                  path={m.bed}
                  style="stroke"
                  strokeWidth={D.ferryLineW * inv}
                  strokeCap="round"
                  color={MAP_INKS.ferryLine}
                >
                  <DashPathEffect intervals={[0.1, 2.55]} />
                </Path>
                {m.slots.map((s, i) => {
                  const isLoco = ferryLocos > 0 && i >= loco.start && i < loco.end;
                  return isLoco ? (
                    <Group
                      key={`p${i}`}
                      transform={[
                        { translateX: s.x },
                        { translateY: s.y },
                        { rotate: s.angle * DEG },
                      ]}
                    >
                      <RoundedRect
                        x={-s.len / 2}
                        y={-slotH / 2}
                        width={s.len}
                        height={slotH}
                        r={slotRx}
                        opacity={carOpacity}
                      >
                        <LinearGradient
                          start={vec(-s.len / 2, 0)}
                          end={vec(s.len / 2, 0)}
                          colors={LIVERY_COLORS as string[]}
                        />
                      </RoundedRect>
                      <RoundedRect
                        x={-s.len / 2}
                        y={-slotH / 2}
                        width={s.len}
                        height={slotH}
                        r={slotRx}
                        style="stroke"
                        strokeWidth={D.ferryLocoStrokeW * inv}
                        color={MAP_INKS.ferryLocoEdge}
                      />
                    </Group>
                  ) : (
                    <Fragment key={`p${i}`}>
                      <Circle
                        cx={s.x}
                        cy={s.y}
                        r={D.ferryPipR * inv}
                        color={fill}
                        opacity={carOpacity}
                      />
                      <Circle
                        cx={s.x}
                        cy={s.y}
                        r={D.ferryPipR * inv}
                        style="stroke"
                        strokeWidth={D.ferryPipStrokeW * inv}
                        color={MAP_INKS.carEdge}
                      />
                    </Fragment>
                  );
                })}
              </>
            ) : (
              m.slots.map((s, i) => {
                // Damaged carriage (web `.slot.broken-car`): hollowed fill + a hazard-dash edge,
                // so the broken block reads as missing track against the intact cars.
                const isBrokenCar = brokenNow && i >= broken.start && i < broken.end;
                return (
                  <Group
                    key={`c${i}`}
                    transform={[{ translateX: s.x }, { translateY: s.y }, { rotate: s.angle * DEG }]}
                  >
                    <RoundedRect
                      x={-s.len / 2}
                      y={-slotH / 2}
                      width={s.len}
                      height={slotH}
                      r={slotRx}
                      color={fill}
                      opacity={isBrokenCar ? 0.16 : carOpacity}
                    />
                    <RoundedRect
                      x={-s.len / 2}
                      y={-slotH / 2}
                      width={s.len}
                      height={slotH}
                      r={slotRx}
                      style="stroke"
                      strokeWidth={slotStrokeW}
                      color={MAP_INKS.carEdge}
                    >
                      {isBrokenCar ? <DashPathEffect intervals={[0.9 * inv, 0.7 * inv]} /> : null}
                    </RoundedRect>
                  </Group>
                );
              })
            )}

            {/* The severed-track bolt across the route middle — the at-a-glance "斷軌" cue
                (web RouteShape's .break-mark: red fill, surface stroke, counter-scaled). */}
            {brokenNow && BREAK_MARK && (
              <Group
                transform={[{ translateX: m.mid.x }, { translateY: m.mid.y }, { scale: inv }]}
              >
                <Path path={BREAK_MARK} color={BREAK_MARK_FILL} />
                <Path
                  path={BREAK_MARK}
                  style="stroke"
                  strokeWidth={0.28}
                  strokeJoin="round"
                  color={PALETTE.surface}
                />
              </Group>
            )}

            {colorBlind && !isOwned && (
              <>
                <Circle cx={m.mid.x} cy={m.mid.y} r={D.glyphR * inv} color={PALETTE.surface} />
                <Circle
                  cx={m.mid.x}
                  cy={m.mid.y}
                  r={D.glyphR * inv}
                  style="stroke"
                  strokeWidth={D.glyphStrokeW * inv}
                  color={PALETTE.ink}
                />
                <BoardText
                  text={glyphOf(m.color)}
                  x={m.mid.x}
                  y={m.mid.y - 1.15 * inv}
                  size={2.3 * inv}
                  color={PALETTE.ink}
                  maxWidth={8}
                />
              </>
            )}
          </Group>
        );
      })}
    </>
  );
}
