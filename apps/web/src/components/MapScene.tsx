// The single source of truth for drawing the map scene — geography, railway network, city
// markers — extracted from the in-game Board. Every map surface (the live board, the login
// backdrop, the map builder's canvas) renders THROUGH this component, each variation being
// nothing but props, so none of them can drift from the in-game map. Purely presentational:
// no stores, no i18n, no content singletons — everything arrives by props. The server's OG
// map card mirrors this scene in string SVG from the same @trm/map-data geometry + tokens.
import type { CSSProperties, MouseEvent, ReactNode, Ref } from 'react';
import type { MapGeography, RouteGeometry } from '@trm/map-data';
import { mapCssVars } from '@trm/map-data';
import type { View } from '../game/geography';
import { CARD_COLOR_TOKENS, GRAY_TOKEN, seatColor } from '../theme/colors';
import { Geography, CustomGeography } from './Geography';
import { RouteShape, FerryLocoGradientDef } from './RouteShape';

/** The minimal city/route shape the scene needs — satisfied by both the live content's
 *  branded CityDef/RouteDef and the map builder's plain-string CityDraft/RouteDraft. */
export interface SceneCity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly isIsland?: boolean | undefined;
}
export interface SceneRoute {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly color: string;
  readonly length: number;
  readonly isTunnel?: boolean | undefined;
  readonly ferryLocos?: number | undefined;
}

/** A route's claim state (from the snapshot): owned by a seat, or locked (double sibling). */
export interface RouteOwnership {
  readonly ownerSeat?: number | undefined;
  readonly locked?: boolean | undefined;
}

const colorOf = (rc: string): string =>
  rc === 'GRAY'
    ? GRAY_TOKEN.hex
    : (CARD_COLOR_TOKENS[rc as keyof typeof CARD_COLOR_TOKENS]?.hex ?? '#888');
const glyphOf = (rc: string): string =>
  rc === 'GRAY'
    ? GRAY_TOKEN.glyph
    : (CARD_COLOR_TOKENS[rc as keyof typeof CARD_COLOR_TOKENS]?.glyph ?? GRAY_TOKEN.glyph);

export interface MapSceneProps<C extends SceneCity, R extends SceneRoute> {
  /* ── content ── */
  cities: readonly C[];
  routes: readonly R[];
  geometry: ReadonlyMap<string, RouteGeometry>;
  hubs: ReadonlySet<string>;
  /** A custom map's cropped-world land rings; `undefined` → the hand-authored Taiwan coast;
   *  `null` → no geography layer at all (the builder before a crop exists). */
  geography?: MapGeography | null | undefined;
  /** The scene's viewBox (the active catalog's baseView, or a draft's). */
  view: View;

  /* ── game state (all optional — omitted renders the plain base-colour network) ── */
  owned?: ReadonlyMap<string, RouteOwnership> | undefined;
  /** cityId → seat of the player whose station stands there. */
  stations?: ReadonlyMap<string, number> | undefined;
  /** routeId → seat: routes currently running their claim glow. */
  glowingRoutes?: ReadonlyMap<string, number> | undefined;
  /** cityId → seat: stations currently running their just-built ring. */
  glowingStations?: ReadonlyMap<string, number> | undefined;
  /** Cities to softly highlight (offered-ticket endpoints): ticket-target class + halo. */
  highlightCities?: ReadonlySet<string> | undefined;
  /** Gates route claimability independently of station buildability — a tutorial `await` beat
   *  waiting on one keeps only that one's affordance (and hover/hit-area) live on the map. */
  canClaim?: boolean | undefined;
  canBuildStation?: boolean | undefined;
  colorBlind?: boolean | undefined;
  /** Draw the required-loco rainbow pips on unclaimed ferries (default true; the login
   *  backdrop turns them off to keep its quiet all-pips look). */
  showFerryLocos?: boolean | undefined;

  /* ── labels + per-surface class hooks ── */
  /** City label text; omitted → no labels at all. */
  cityLabel?: ((city: C) => string) | undefined;
  /** Label level-of-detail tier ('major'/'secondary'/'tertiary'/'minor'); non-minor tiers
   *  become classes on the city group (see game/lod.ts + the [data-zoom] CSS). */
  cityTier?: ((cityId: string) => string) | undefined;
  /** Tooltip for a claimable route's hit path. */
  routeTitle?: ((route: R) => string) | undefined;
  /** Extra class(es) appended to a route group (the editor's editor-route states). */
  routeClass?: ((route: R) => string) | undefined;
  /** Extra class(es) appended to a city group (the editor's editor-city states). */
  cityClass?: ((city: C) => string) | undefined;
  /** Render a hit path on every route regardless of claimability (the editor's selection). */
  alwaysHitRoutes?: boolean | undefined;
  /** Where a city click lands: the marker only (the board — labels stay inert, marker gets a
   *  <title>) or the whole group incl. label (the editor). Default 'marker'. */
  cityHitArea?: 'marker' | 'group' | undefined;

  /* ── per-element extension points (the board's random-events dressing) ── */
  /** Extra claimability predicate ANDed into the usual canClaim/unowned gate (e.g. a
   *  typhoon-closed route can't be claimed even while unowned). */
  claimFilter?: ((route: R) => boolean) | undefined;
  /** Extra data-* attributes spread onto a route group (e.g. data-closed). */
  routeData?: ((route: R) => Record<`data-${string}`, string | undefined>) | undefined;
  /** Extra data-* attributes spread onto a city group (e.g. data-hotspot). */
  cityData?: ((city: C) => Record<`data-${string}`, string | undefined>) | undefined;
  /** Extra content rendered inside a route's group, after the colour-blind badge
   *  (the board's typhoon / reopen-bonus chips). */
  renderRouteOverlay?: ((route: R, geometry: RouteGeometry) => ReactNode) | undefined;
  /** Extra content rendered inside a city's group, after the station ring and before the
   *  label (the board's charter chip / hotspot badge). */
  renderCityOverlay?: ((city: C) => ReactNode) | undefined;

  /* ── interaction ── */
  onRouteClick?: ((routeId: string) => void) | undefined;
  onCityClick?: ((cityId: string) => void) | undefined;

  /* ── svg root ── */
  svgRef?: Ref<SVGSVGElement> | undefined;
  onSvgClick?: ((e: MouseEvent<SVGSVGElement>) => void) | undefined;
  preserveAspectRatio?: string | undefined;
  /** Extra class on the `svg.board` root (e.g. the editor's `editor-canvas`). */
  className?: string | undefined;
  /** Merged over the token vars (e.g. the backdrop pinning `--inv-scale`). */
  style?: CSSProperties | undefined;
  ariaLabel?: string | undefined;
  /** Overlay layers drawn above the cities (the board's ticket sweeps / trail reveal). */
  children?: ReactNode;
}

export function MapScene<C extends SceneCity, R extends SceneRoute>({
  cities,
  routes,
  geometry,
  hubs,
  geography,
  view,
  owned,
  stations,
  glowingRoutes,
  glowingStations,
  highlightCities,
  canClaim,
  canBuildStation,
  colorBlind,
  showFerryLocos,
  cityLabel,
  cityTier,
  routeTitle,
  routeClass,
  cityClass,
  alwaysHitRoutes,
  cityHitArea,
  claimFilter,
  routeData,
  cityData,
  renderRouteOverlay,
  renderCityOverlay,
  onRouteClick,
  onCityClick,
  svgRef,
  onSvgClick,
  preserveAspectRatio,
  className,
  style,
  ariaLabel,
  children,
}: MapSceneProps<C, R>) {
  const viewBox = `${view.x} ${view.y} ${view.w} ${view.h}`;
  // The shared dimension tokens ride on the root, so every game.css rule below resolves them.
  const rootStyle: CSSProperties = { ...(mapCssVars() as CSSProperties), ...style };
  return (
    <svg
      ref={svgRef}
      className={className ? `board ${className}` : 'board'}
      viewBox={viewBox}
      role="img"
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      {...(preserveAspectRatio !== undefined ? { preserveAspectRatio } : {})}
      style={rootStyle}
      {...(onSvgClick ? { onClick: onSvgClick } : {})}
    >
      <FerryLocoGradientDef />
      {geography === undefined ? (
        <Geography />
      ) : geography === null ? null : (
        <CustomGeography geography={geography} />
      )}

      {routes.map((r) => {
        const g = geometry.get(r.id);
        if (!g) return null;

        const o = owned?.get(r.id);
        const claimable = !!canClaim && !o && !!onRouteClick && (claimFilter ? claimFilter(r) : true);
        const clickable = claimable || (!!alwaysHitRoutes && !!onRouteClick);
        // Unclaimed → route colour; claimed → owner's seat colour; locked → muted grey.
        const fill =
          o?.ownerSeat !== undefined
            ? seatColor(o.ownerSeat)
            : o?.locked
              ? '#9aa0a6'
              : colorOf(r.color);
        const carOpacity = o?.locked ? 0.45 : 1;
        const isFerry = (r.ferryLocos ?? 0) > 0;
        const kind = r.isTunnel ? ' tunnel' : isFerry ? ' ferry' : '';
        const glowSeat = glowingRoutes?.get(r.id);
        const routeHook = routeClass?.(r);
        const extra = routeHook ? ` ${routeHook}` : '';
        const cls =
          'route' +
          (claimable ? ' claimable' : '') +
          (o ? ' owned' : '') +
          (glowSeat !== undefined ? ' just-claimed' : '') +
          kind +
          extra;
        // The owner's seat colour, exposed to CSS so a claimed route tints its whole roadbed
        // (the "background") to its owner — and the glow bloom reuses the same `--seat`.
        const seatCss = glowSeat ?? o?.ownerSeat;
        // Double-route siblings split apart by a perpendicular nudge that counter-scales with
        // the track weight (--inv-scale), so the twin tracks stay snug at any zoom.
        const groupStyle: CSSProperties = {
          ...(g.perp.x || g.perp.y
            ? {
                transform: `translate(calc(${g.perp.x.toFixed(3)}px * var(--inv-scale)), calc(${g.perp.y.toFixed(3)}px * var(--inv-scale)))`,
              }
            : null),
          ...(seatCss !== undefined ? ({ '--seat': seatColor(seatCss) } as CSSProperties) : null),
        };
        const pick = onRouteClick
          ? (e: MouseEvent) => {
              e.stopPropagation();
              onRouteClick(r.id);
            }
          : undefined;

        return (
          <g
            key={r.id}
            className={cls}
            data-route-id={r.id}
            {...routeData?.(r)}
            style={groupStyle}
            onClick={clickable ? pick : undefined}
          >
            <RouteShape
              geometry={g}
              isTunnel={!!r.isTunnel}
              isFerry={isFerry}
              // Unclaimed ferries show their required-loco block; once owned, every pip takes
              // the owner's colour (no rainbow), so the highlight count drops to zero.
              ferryLocos={o || showFerryLocos === false ? 0 : (r.ferryLocos ?? 0)}
              length={r.length}
              fill={fill}
              carOpacity={carOpacity}
            />

            {(claimable || alwaysHitRoutes) && (
              <path className="hit" d={g.path}>
                {routeTitle && <title>{routeTitle(r)}</title>}
              </path>
            )}
            {/* Colour-blind aid: a glyph chip naming the colour you pay (length is the car count). */}
            {colorBlind && !o && (
              <g className="glyph-badge">
                <circle cx={g.mid.x} cy={g.mid.y} />
                <text x={g.mid.x} y={g.mid.y}>
                  {glyphOf(r.color)}
                </text>
              </g>
            )}
            {renderRouteOverlay?.(r, g)}
          </g>
        );
      })}

      {cities.map((c) => {
        const stationSeat = stations?.get(c.id);
        const hasStation = stationSeat !== undefined;
        const buildable = !!canBuildStation && !hasStation && !!onCityClick;
        const isHub = hubs.has(c.id);
        // Tier drives the cartographic label level-of-detail (see game/lod.ts + the
        // [data-zoom] rules in game.css); islands always keep their label.
        const tier = cityTier?.(c.id);
        const isTarget = highlightCities?.has(c.id) ?? false;
        const cityHook = cityClass?.(c);
        const extra = cityHook ? ` ${cityHook}` : '';
        const cls =
          'city' +
          (c.isIsland ? ' island' : '') +
          (isHub ? ' hub' : '') +
          (tier && tier !== 'minor' ? ` ${tier}` : '') +
          (isTarget ? ' ticket-target' : '') +
          extra;
        const pick = onCityClick
          ? (e: MouseEvent) => {
              e.stopPropagation();
              onCityClick(c.id);
            }
          : undefined;
        const onMarker = cityHitArea === 'group' ? undefined : buildable ? pick : undefined;
        const onGroup = cityHitArea === 'group' ? pick : undefined;
        const markerTitle =
          cityHitArea !== 'group' && cityLabel ? <title>{cityLabel(c)}</title> : null;
        const builtSeat = glowingStations?.get(c.id);
        const justBuilt = builtSeat !== undefined;
        return (
          <g key={c.id} data-city-id={c.id} {...cityData?.(c)} className={cls} onClick={onGroup}>
            {/* Offered-ticket endpoint: a soft halo behind the marker so the player can trace
                the railways a ticket needs while the chooser holds the rail. */}
            {isTarget && <circle className="ticket-target-halo" cx={c.x} cy={c.y} />}
            {/* Junctions where many lines converge read as a wider slot-shaped station;
                ordinary stops stay round. Geometry comes from CSS (so it can grow with
                zoom via --marker-scale); the transform just plants it on the city. */}
            {isHub ? (
              <rect
                className={buildable ? 'city-hub buildable' : 'city-hub'}
                transform={`translate(${c.x} ${c.y})`}
                onClick={onMarker}
              >
                {markerTitle}
              </rect>
            ) : (
              <circle
                className={buildable ? 'city-dot buildable' : 'city-dot'}
                cx={c.x}
                cy={c.y}
                onClick={onMarker}
              >
                {markerTitle}
              </circle>
            )}
            {hasStation &&
              (isHub ? (
                <rect
                  className={justBuilt ? 'station-hub just-built' : 'station-hub'}
                  transform={`translate(${c.x} ${c.y})`}
                  style={{ fill: seatColor(stationSeat) }}
                />
              ) : (
                <circle
                  className={justBuilt ? 'station just-built' : 'station'}
                  cx={c.x}
                  cy={c.y}
                  style={{ fill: seatColor(stationSeat) }}
                />
              ))}
            {justBuilt && (
              <circle
                className="station-ring"
                cx={c.x}
                cy={c.y}
                r={0.5}
                style={{ '--seat': seatColor(builtSeat) } as CSSProperties}
              />
            )}
            {renderCityOverlay?.(c)}
            {cityLabel && (
              <text className="city-label" x={c.x} y={c.y}>
                {cityLabel(c)}
              </text>
            )}
          </g>
        );
      })}

      {children}
    </svg>
  );
}
