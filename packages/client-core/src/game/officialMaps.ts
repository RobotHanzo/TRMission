import { OFFICIAL_MAPS } from '@trm/map-data';
import type { Locale } from '../net/restTypes';

export interface OfficialMapOption {
  mapId: string;
  label: string;
}

/**
 * The official maps a host may pick, resolved for display — shared by both clients' room
 * settings pickers.
 *
 * A maintainer can switch a shipped map off from the dashboard (`GET /maps/official/enabled`),
 * so the bundled `OFFICIAL_MAPS` registry is the set of maps this build can *render*, not the
 * set a room may currently be set to. `enabledMapIds === null` means the list has not arrived
 * yet (or the request failed): offer everything bundled rather than an empty picker — the
 * server rejects a switched-off selection on the settings PATCH and again at start, so this is
 * never the gate.
 *
 * `selectedMapId` is always kept in the list even when it is off: a room already sitting on a
 * map that was just switched off must still render its own value instead of going blank.
 */
export function officialMapOptions(
  enabledMapIds: readonly string[] | null,
  locale: Locale,
  selectedMapId?: string,
): OfficialMapOption[] {
  return OFFICIAL_MAPS.filter(
    (m) => enabledMapIds === null || enabledMapIds.includes(m.mapId) || m.mapId === selectedMapId,
  ).map((m) => ({
    mapId: m.mapId,
    label: locale === 'en' ? m.content.meta.nameEn : m.content.meta.nameZh,
  }));
}

/** The map to select when a host switches the source back to "official": the first one still on
 *  offer, or undefined if this build bundles none of them. */
export function firstOfficialMapId(enabledMapIds: readonly string[] | null): string | undefined {
  return officialMapOptions(enabledMapIds, 'en')[0]?.mapId;
}
