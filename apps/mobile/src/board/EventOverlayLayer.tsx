// Random-events board overlays — the Skia port of the web Board's `renderRouteOverlay` /
// `renderCityOverlay` / trail-and-link children (apps/web/src/components/Board.tsx), driven by
// the SAME client-core `boardEventOverlays` projection so the two boards can never disagree.
// Rendered LIVE in MapSceneSkia (outside the cached static Picture): the event slice changes
// per-round and must not force a picture re-record. All sizes mirror game.css's `--inv-scale` /
// `--marker-scale` calc() rules; the `bucket` gates mirror its `[data-zoom]` display rules.
import { useMemo } from 'react';
import { Circle, DashPathEffect, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { Skia } from '@shopify/react-native-skia';
import { MAP_DIMS } from '@trm/map-data';
import type { BoardEventOverlays } from '../game/events';
import { BoardText } from './skiaText';
import type { RouteRenderModel } from './scenePaths';
import type { SceneCity, RouteOwnership } from './MapSceneSkia';
import type { ZoomBucket } from './camera';

// Web tokens.css / game.css evt-* colours (light theme — the board is always drawn on paper).
const SURFACE = '#fffdf8';
const INK_SOFT = '#5b6168';
const OK_GREEN = '#3a9d5c';
const EMU_BLUE = '#0f5fa6';
const LUCKY_GOLD = '#d49a18';
const HOTSPOT_AMBER = '#e08a1e';
const LANTERN_EMBER = '#d96c24';
const PROCESSION_PURPLE = '#8b4eb5';
const PROCESSION_TRAIL = '#9a62bd';
const BENTO_BROWN = '#b8643a';
const NIGHT_NAVY = '#314d92';
const SKY_AMBER = '#f0a528';
const CLOSED_WASH = '#b9bdc2';

/** A round city/route badge: filled disc, white rim, short white label — web `.evt-city-badge`.
 *  `dx`/`dy` pick the quadrant (±2.7 × inv, hugging the marker at any zoom). */
function Badge({
  x,
  y,
  dx,
  dy,
  fill,
  label,
  inv,
}: {
  x: number;
  y: number;
  dx: number;
  dy: number;
  fill: string;
  label: string;
  inv: number;
}) {
  const r = 2.6 * inv;
  const size = 2.5 * inv;
  const cx = x + dx * inv;
  const cy = y + dy * inv;
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} color={fill} />
      <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={0.36 * inv} color="#fff" />
      <BoardText
        text={label}
        x={cx}
        y={cy - size * 0.62}
        size={size}
        color="#fff"
        maxWidth={10 * inv}
      />
    </Group>
  );
}

export interface EventOverlayLayerProps {
  events: BoardEventOverlays;
  modelById: ReadonlyMap<string, RouteRenderModel>;
  cityById: ReadonlyMap<string, SceneCity>;
  owned?: ReadonlyMap<string, RouteOwnership> | undefined;
  bucket: ZoomBucket;
  inv: number;
  marker: number;
}

export function EventOverlayLayer({
  events,
  modelById,
  cityById,
  owned,
  bucket,
  inv,
  marker,
}: EventOverlayLayerProps) {
  const {
    closedRoutes,
    reopenRoutes,
    skyRoutes,
    harvestRoutes,
    hotspots,
    charterCities,
    luckyCities,
    luckyLinks,
    lanternCity,
    processionPath,
    processionCity,
    bentoCities,
    nightMarketCities,
  } = events;

  // Dense chips/badges drop out of the two most zoomed-out tiers (web `[data-zoom]` rules).
  const showBadges = bucket !== 'far';
  const showHotspots = showBadges && bucket !== 'regional';

  // The procession's dashed trail through its city path (web `.evt-procession-trail` polyline),
  // built via the SVG-string path (the only constructor the jest Skia mock also supports).
  const trailPath = useMemo(() => {
    if (processionPath.length < 2) return null;
    const pts = processionPath
      .map((id) => cityById.get(id))
      .filter((c): c is SceneCity => c !== undefined);
    if (pts.length < 2) return null;
    const d = pts.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    try {
      return Skia.Path.MakeFromSVGString(d);
    } catch {
      return null;
    }
  }, [processionPath, cityById]);

  return (
    <Group>
      {/* ── route washes (always visible, like the web's CSS filters on the route art) ── */}
      {[...skyRoutes].map((rid) => {
        const m = modelById.get(rid);
        if (!m) return null;
        return (
          <Group
            key={`sky:${rid}`}
            transform={[{ translateX: m.perp.x * inv }, { translateY: m.perp.y * inv }]}
          >
            <Path
              path={m.bed}
              style="stroke"
              strokeWidth={MAP_DIMS.bedOwnedW * 2 * inv}
              strokeCap="round"
              color={SKY_AMBER}
              opacity={0.4}
            />
          </Group>
        );
      })}
      {[...harvestRoutes].map((rid) => {
        const m = modelById.get(rid);
        if (!m) return null;
        return (
          <Group
            key={`harvest:${rid}`}
            transform={[{ translateX: m.perp.x * inv }, { translateY: m.perp.y * inv }]}
          >
            <Path
              path={m.bed}
              style="stroke"
              strokeWidth={MAP_DIMS.bedOwnedW * 1.8 * inv}
              strokeCap="round"
              color={OK_GREEN}
              opacity={0.35}
            />
          </Group>
        );
      })}
      {[...closedRoutes].map((rid) => {
        const m = modelById.get(rid);
        if (!m) return null;
        return (
          <Group
            key={`closed:${rid}`}
            transform={[{ translateX: m.perp.x * inv }, { translateY: m.perp.y * inv }]}
          >
            {/* Grey wash stands in for the web's grayscale filter (the picture is flattened). */}
            <Path
              path={m.bed}
              style="stroke"
              strokeWidth={MAP_DIMS.bedOwnedW * 1.3 * inv}
              strokeCap="round"
              color={CLOSED_WASH}
              opacity={0.55}
            />
            {showBadges && (
              <Group>
                <Circle cx={m.mid.x} cy={m.mid.y} r={2.6 * inv} color={SURFACE} />
                <Circle
                  cx={m.mid.x}
                  cy={m.mid.y}
                  r={2.6 * inv}
                  style="stroke"
                  strokeWidth={0.3 * inv}
                  color={INK_SOFT}
                />
                <BoardText
                  text="🌀"
                  x={m.mid.x}
                  y={m.mid.y - 1.85 * inv}
                  size={3 * inv}
                  color={INK_SOFT}
                  maxWidth={10 * inv}
                />
              </Group>
            )}
          </Group>
        );
      })}
      {/* Reopened route: the +2 first-claim chip (only while unclaimed). */}
      {showBadges &&
        [...reopenRoutes].map((rid) => {
          const m = modelById.get(rid);
          if (!m || owned?.get(rid)) return null;
          return (
            <Group
              key={`reopen:${rid}`}
              transform={[{ translateX: m.perp.x * inv }, { translateY: m.perp.y * inv }]}
            >
              <Circle cx={m.mid.x} cy={m.mid.y} r={2.6 * inv} color={OK_GREEN} />
              <Circle
                cx={m.mid.x}
                cy={m.mid.y}
                r={2.6 * inv}
                style="stroke"
                strokeWidth={0.32 * inv}
                color="#fff"
              />
              <BoardText
                text="+2"
                x={m.mid.x}
                y={m.mid.y - 1.7 * inv}
                size={2.8 * inv}
                color="#fff"
                maxWidth={10 * inv}
              />
            </Group>
          );
        })}

      {/* ── city-anchored links & rings ── */}
      {luckyLinks.map((link) => {
        const a = cityById.get(link.a);
        const b = cityById.get(link.b);
        if (!a || !b) return null;
        return (
          <Line
            key={`lucky-link:${link.id}`}
            p1={vec(a.x, a.y)}
            p2={vec(b.x, b.y)}
            style="stroke"
            strokeWidth={0.45 * inv}
            color={LUCKY_GOLD}
            opacity={0.58}
          >
            <DashPathEffect intervals={[0.9 * inv, 0.8 * inv]} />
          </Line>
        );
      })}
      {trailPath && (
        <Path
          path={trailPath}
          style="stroke"
          strokeWidth={0.65 * inv}
          color={PROCESSION_TRAIL}
          opacity={0.72}
        >
          <DashPathEffect intervals={[1.2 * inv, 0.8 * inv]} />
        </Path>
      )}
      {showBadges &&
        [...charterCities].map((cid) => {
          const c = cityById.get(cid);
          if (!c) return null;
          return (
            <Circle
              key={`charter:${cid}`}
              cx={c.x}
              cy={c.y}
              r={2.6 * marker}
              style="stroke"
              strokeWidth={0.55 * inv}
              color={EMU_BLUE}
            >
              <DashPathEffect intervals={[0.9 * inv, 0.7 * inv]} />
            </Circle>
          );
        })}
      {showBadges &&
        [...luckyCities].map((cid) => {
          const c = cityById.get(cid);
          if (!c) return null;
          return (
            <Circle
              key={`lucky:${cid}`}
              cx={c.x}
              cy={c.y}
              r={3.1 * marker}
              style="stroke"
              strokeWidth={0.62 * inv}
              color={LUCKY_GOLD}
            >
              <DashPathEffect intervals={[0.7 * inv, 0.45 * inv]} />
            </Circle>
          );
        })}

      {/* ── city badges (quadrants mirror web: lantern NW, procession/hotspot NE, bento SW,
             night-market SE) ── */}
      {showBadges &&
        lanternCity &&
        (() => {
          const c = cityById.get(lanternCity);
          if (!c) return null;
          return (
            <Badge x={c.x} y={c.y} dx={-2.7} dy={-2.7} fill={LANTERN_EMBER} label="+6" inv={inv} />
          );
        })()}
      {showBadges &&
        processionCity &&
        (() => {
          const c = cityById.get(processionCity);
          if (!c) return null;
          return (
            <Badge
              x={c.x}
              y={c.y}
              dx={2.7}
              dy={-2.7}
              fill={PROCESSION_PURPLE}
              label="P"
              inv={inv}
            />
          );
        })()}
      {showBadges &&
        [...bentoCities].map((cid) => {
          const c = cityById.get(cid);
          if (!c) return null;
          return (
            <Badge
              key={`bento:${cid}`}
              x={c.x}
              y={c.y}
              dx={-2.7}
              dy={2.7}
              fill={BENTO_BROWN}
              label="B"
              inv={inv}
            />
          );
        })}
      {showBadges &&
        [...nightMarketCities].map((cid) => {
          const c = cityById.get(cid);
          if (!c) return null;
          return (
            <Badge
              key={`night:${cid}`}
              x={c.x}
              y={c.y}
              dx={2.7}
              dy={2.7}
              fill={NIGHT_NAVY}
              label="N"
              inv={inv}
            />
          );
        })}
      {showHotspots &&
        [...hotspots].map(([cid, level]) => {
          const c = cityById.get(cid);
          if (!c) return null;
          return (
            <Badge
              key={`hotspot:${cid}`}
              x={c.x}
              y={c.y}
              dx={2.7}
              dy={-2.7}
              fill={HOTSPOT_AMBER}
              label={`+${level}`}
              inv={inv}
            />
          );
        })}
    </Group>
  );
}
