// The lobby's game settings as a layered board (issue #64): an index naming each group and what
// it is set to, and one page per group holding the controls — the shape the mobile Settings tab
// uses, ported to the room so both clients read the same.
//
// The dotted leader running from a group's name out to its value is the point of the layout (the
// same timetable voice as the HUD tray heads and the player card's ledger): the reader can answer
// "what is this table set to?" from the index alone, so the extra layer costs them nothing. The
// groups, their order, and how each value reads live in @trm/client-core — shared with mobile.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  CloudLightning,
  DoorOpen,
  Globe,
  Lock,
  Map as MapIcon,
  ScrollText,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { EventsMode } from '@trm/shared';
import {
  HOUSE_RULES,
  SOLO_WAIT_RULE,
  roomSettingsGroups,
  type RoomSettingsGroupId,
  type TranslateSetting,
} from '@trm/client-core/game/roomSettingsMenu';
import { firstOfficialMapId, officialMapOptions } from '@trm/client-core/game/officialMaps';
import type { MapSummary, RoomSettings, RoomVisibility } from '../net/rest';
import type { Locale } from '../store/ui';
import { Switch } from './ui/Switch';
import { Segmented } from './ui/Segmented';

const GROUP_ICONS: Record<RoomSettingsGroupId, LucideIcon> = {
  map: MapIcon,
  rules: ScrollText,
  events: CloudLightning,
  teams: Users,
  access: DoorOpen,
};

interface Props {
  settings: RoomSettings;
  /** Read-only for everyone but the host, and for everyone once the game has started. */
  locked: boolean;
  /** The host may pick a custom map only while holding the mapBuilder feature. */
  canBuild: boolean;
  /** Whether the random-events group is on the board at all (feature-gated for the host). */
  showEvents: boolean;
  /** Whether the solo "wait for me" rule applies — exactly one human is seated. */
  showSoloWait: boolean;
  /** Seated players, for the team-layout warning. */
  seatedCount: number;
  /** The host's own custom maps (null while still loading). */
  myMaps: MapSummary[] | null;
  /** Official maps currently on offer, from the server (null = not loaded; offer them all). */
  officialMapIds: string[] | null;
  /** The selected map's display name, resolved against the active locale. */
  mapName: string;
  locale: Locale;
  onChange(patch: Partial<RoomSettings>): void;
  /** Team count goes through the room's own guard (it can reject a shrink that would evict a seat). */
  onChangeTeamCount(next: number): void;
  onCreateMap(): void;
}

export function RoomSettingsPanel(props: Props) {
  const { t } = useTranslation();
  const { settings, locked } = props;
  const [open, setOpen] = useState<RoomSettingsGroupId | null>(null);

  // The shared board builder takes a plain translator; i18next's overloaded `t` needs adapting.
  const tr: TranslateSetting = (key, params) => (params ? t(key, params) : t(key));
  const groups = roomSettingsGroups(
    {
      settings,
      mapName: props.mapName,
      showEvents: props.showEvents,
      showSoloWait: props.showSoloWait,
      seatedCount: props.seatedCount,
    },
    tr,
  );
  const current = groups.find((g) => g.id === open);

  return (
    <section className="card stack game-settings" aria-labelledby="room-settings-title">
      <div className="rsm-head">
        {current ? (
          <button className="rsm-back" onClick={() => setOpen(null)}>
            <ChevronLeft size={16} aria-hidden />
            {t('settingsBack')}
          </button>
        ) : (
          <h3 id="room-settings-title">{t('gameSettings')}</h3>
        )}
        {locked && (
          <span className="rsm-locked">
            <Lock size={13} aria-hidden /> {t('settingsHostOnly')}
          </span>
        )}
      </div>

      {current ? (
        <div className="rsm-page" key={current.id}>
          <h3 className="rsm-page-title">{current.title}</h3>
          {current.warning && <p className="warn rsm-warn">{current.warning}</p>}
          <fieldset className="rsm-controls" disabled={locked}>
            <GroupControls {...props} group={current.id} />
          </fieldset>
        </div>
      ) : (
        <ul className="rsm-board">
          {groups.map((g) => {
            const Icon = GROUP_ICONS[g.id];
            return (
              <li key={g.id}>
                <button className="rsm-row" onClick={() => setOpen(g.id)}>
                  <span className="rsm-badge" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <span className="rsm-name">{g.title}</span>
                  <span className="rsm-leader" aria-hidden />
                  <span className="rsm-value">{g.value}</span>
                  <ChevronRight className="rsm-go" size={16} aria-hidden />
                </button>
                {g.warning && <p className="warn rsm-warn">{g.warning}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One group's controls. Each row keeps the label/description pairing the flat card had — the
 *  layer above states the value, this layer explains what it means. */
function GroupControls({
  group,
  settings,
  canBuild,
  showSoloWait,
  myMaps,
  officialMapIds,
  mapName,
  locale,
  locked,
  onChange,
  onChangeTeamCount,
  onCreateMap,
}: Props & { group: RoomSettingsGroupId }) {
  const { t } = useTranslation();
  const teamCount = settings.teamCount ?? 0;

  if (group === 'map') {
    // A member who can't edit reads the resolved name; the host gets source + list.
    if (locked) return <p className="rsm-readout">{mapName}</p>;
    const officialMaps = officialMapOptions(
      officialMapIds,
      locale,
      settings.map.source === 'official' ? settings.map.mapId : undefined,
    );
    return (
      <div className="setting stack">
        <Segmented<'official' | 'custom'>
          options={
            canBuild
              ? [
                  { value: 'official', label: t('mapOfficial') },
                  { value: 'custom', label: t('mapCustom') },
                ]
              : [{ value: 'official', label: t('mapOfficial') }]
          }
          value={settings.map.source}
          onChange={(src) => {
            if (src === 'official') {
              const first = firstOfficialMapId(officialMapIds);
              if (first) onChange({ map: { source: 'official', mapId: first } });
            } else if (myMaps && myMaps.length > 0) {
              onChange({ map: { source: 'custom', customMapId: myMaps[0]!.id } });
            } else {
              onCreateMap();
            }
          }}
          ariaLabel={t('mapLabel')}
        />
        {settings.map.source === 'official' ? (
          <select
            aria-label={t('mapOfficial')}
            value={settings.map.mapId}
            onChange={(e) => onChange({ map: { source: 'official', mapId: e.target.value } })}
          >
            {officialMaps.map((m) => (
              <option key={m.mapId} value={m.mapId}>
                {m.label}
              </option>
            ))}
          </select>
        ) : myMaps && myMaps.length > 0 ? (
          <select
            aria-label={t('mapCustom')}
            value={settings.map.customMapId}
            onChange={(e) => onChange({ map: { source: 'custom', customMapId: e.target.value } })}
          >
            {myMaps.map((m) => (
              <option key={m.id} value={m.id}>
                {locale === 'en' ? m.nameEn : m.nameZh}
              </option>
            ))}
          </select>
        ) : (
          <button onClick={onCreateMap}>
            <MapIcon size={14} aria-hidden /> {t('mapCreateOne')}
          </button>
        )}
      </div>
    );
  }

  if (group === 'rules') {
    const rules = showSoloWait ? [...HOUSE_RULES, SOLO_WAIT_RULE] : HOUSE_RULES;
    return (
      <>
        {rules.map((rule) => (
          <div key={rule.key} className="row between setting-row">
            <span>
              <strong>{t(rule.labelKey)}</strong>
              <br />
              <span className="muted">{t(rule.descKey)}</span>
            </span>
            <Switch
              checked={settings[rule.key]}
              onChange={(next) => onChange({ [rule.key]: next } as Partial<RoomSettings>)}
              label={t(rule.labelKey)}
            />
          </div>
        ))}
      </>
    );
  }

  if (group === 'events') {
    return (
      <div className="setting stack">
        <span className="muted">{t('settingRandomEventsDesc')}</span>
        <Segmented<EventsMode>
          options={[
            { value: 'off', label: t('eventsMode_off') },
            { value: 'light', label: t('eventsMode_light') },
            { value: 'moderate', label: t('eventsMode_moderate') },
            { value: 'intense', label: t('eventsMode_intense') },
          ]}
          value={settings.eventsMode}
          onChange={(v) => onChange({ eventsMode: v })}
          ariaLabel={t('settingRandomEvents')}
        />
      </div>
    );
  }

  if (group === 'teams') {
    return (
      <>
        <div className="setting stack">
          <span className="muted">{t('settingTeamModeDesc')}</span>
          <Segmented<'0' | '2' | '3'>
            options={[
              { value: '0', label: t('teamModeOff') },
              { value: '2', label: t('teamMode2Teams') },
              { value: '3', label: t('teamMode3Teams') },
            ]}
            value={String(teamCount) as '0' | '2' | '3'}
            onChange={(v) => onChangeTeamCount(Number(v))}
            ariaLabel={t('settingTeamMode')}
          />
        </div>
        {teamCount > 0 && (
          <div className="setting stack">
            <strong>{t('settingTeamAssignMode')}</strong>
            <span className="muted">{t('settingTeamAssignModeDesc')}</span>
            <Segmented<'random' | 'host' | 'self'>
              options={[
                { value: 'random', label: t('teamAssignModeRandom') },
                { value: 'host', label: t('teamAssignModeHost') },
                { value: 'self', label: t('teamAssignModeSelf') },
              ]}
              value={settings.teamAssignMode}
              onChange={(v) => onChange({ teamAssignMode: v })}
              ariaLabel={t('settingTeamAssignMode')}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="setting stack">
        <strong>{t('roomVisibility')}</strong>
        <Segmented<RoomVisibility>
          options={[
            { value: 'PUBLIC', label: t('visibility_PUBLIC'), icon: Globe },
            { value: 'INVITE_ONLY', label: t('visibility_INVITE_ONLY'), icon: Lock },
          ]}
          value={settings.visibility}
          onChange={(v) => onChange({ visibility: v })}
          ariaLabel={t('roomVisibility')}
        />
      </div>
      <div className="row between setting-row">
        <strong>{t('allowSpectating')}</strong>
        <Switch
          checked={settings.allowSpectating}
          onChange={(next) => onChange({ allowSpectating: next })}
          label={t('allowSpectating')}
        />
      </div>
    </>
  );
}
