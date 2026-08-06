// Settings ▸ Appearance: theme, language, board layout, colour-blind glyphs. Every change applies
// instantly (the ui store persists on-device) and then syncs to the account — a no-op for guests.
import { useTranslation } from 'react-i18next';
import { Switch } from 'react-native';
import { Languages, PanelRight, Shapes, SunMoon, TrainFront } from 'lucide-react-native';
import type { TrainCarSkin } from '@trm/shared';
import { trainCarSkinOptions } from '@trm/client-core/game/trainCarSkins';
import type { BoardLayout, Locale, Theme, UserPreferences } from '../../net/rest';
import { useGlassHeaderPad } from '../../hooks/useGlassHeaderPad';
import { useSession } from '../../store/session';
import { useUi } from '../../store/ui';
import { ChoiceRow, SettingsGroup, SettingsPage, SettingsRow } from './chrome';

export default function AppearanceScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const headerPad = useGlassHeaderPad();
  const savePreferences = useSession((s) => s.savePreferences);

  const theme = useUi((s) => s.theme);
  const locale = useUi((s) => s.locale);
  const colorBlind = useUi((s) => s.colorBlind);
  const boardLayout = useUi((s) => s.boardLayout);
  const trainCarSkin = useUi((s) => s.trainCarSkin);
  const availableTrainCarSkins = useUi((s) => s.availableTrainCarSkins);
  const setTheme = useUi((s) => s.setTheme);
  const setLocale = useUi((s) => s.setLocale);
  const setColorBlind = useUi((s) => s.setColorBlind);
  const setBoardLayout = useUi((s) => s.setBoardLayout);
  const setTrainCarSkin = useUi((s) => s.setTrainCarSkin);

  // Apply immediately for snappy feedback, then sync the full set to the account. Spreading the
  // current values keeps every preference in the payload.
  const persist = (patch: Partial<UserPreferences>): void =>
    void savePreferences({
      theme,
      colorBlind,
      locale,
      boardLayout,
      trainCarSkin,
      ...patch,
    }).catch(() => undefined);

  // Only the packs a maintainer currently offers; a single-pack list means nothing to choose.
  const skinOptions = trainCarSkinOptions(availableTrainCarSkins, locale);

  return (
    <SettingsPage topPad={headerPad} testID="settings-appearance">
      <SettingsGroup>
        <ChoiceRow<Theme>
          first
          icon={SunMoon}
          label={t('settings.theme')}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') },
          ]}
          value={theme}
          onChange={(next) => {
            void setTheme(next);
            persist({ theme: next });
          }}
          testIDPrefix="theme"
        />
        <ChoiceRow<Locale>
          icon={Languages}
          label={t('settings.language')}
          options={[
            { value: 'zh-Hant', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
          value={locale}
          onChange={(next) => {
            void setLocale(next);
            persist({ locale: next });
          }}
          testIDPrefix="locale"
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.boardGroup')} footnote={t('settings.colorBlindDesc')}>
        <ChoiceRow<BoardLayout>
          first
          icon={PanelRight}
          label={t('settings.layout')}
          hint={t('settings.layoutHint')}
          options={[
            { value: 'rail', label: t('settings.layoutRail') },
            { value: 'tray', label: t('settings.layoutTray') },
          ]}
          value={boardLayout}
          onChange={(next) => {
            void setBoardLayout(next);
            persist({ boardLayout: next });
          }}
          testIDPrefix="layout"
        />
        {skinOptions.length > 1 && (
          <ChoiceRow<TrainCarSkin>
            icon={TrainFront}
            label={t('settings.trainCarSkin')}
            hint={t('settings.trainCarSkinDesc')}
            options={skinOptions.map(({ skin, label }) => ({ value: skin, label }))}
            value={trainCarSkin}
            onChange={(next) => {
              void setTrainCarSkin(next);
              persist({ trainCarSkin: next });
            }}
            testIDPrefix="train-car-skin"
          />
        )}
        <SettingsRow
          icon={Shapes}
          label={t('settings.colorBlind')}
          trailing={
            <Switch
              testID="colorblind-switch"
              value={colorBlind}
              onValueChange={(next) => {
                void setColorBlind(next);
                persist({ colorBlind: next });
              }}
            />
          }
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
