import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../../../../components/ui/Segmented';
import { CropDrawStage } from './CropDrawStage';
import { CountryPickStage } from './CountryPickStage';
import { CityPickStage } from './CityPickStage';

type CropMode = 'draw' | 'countries' | 'cities';

/** Three on-ramps into the same draft.geography: draw a rectangle (CropDrawStage), pick whole
 *  countries (CountryPickStage), or pick Taiwanese cities/縣市 (CityPickStage) — each by click or
 *  search. Switching modes unmounts the others, discarding whatever unconfirmed selection they had
 *  — nothing commits to the store until that mode's own Confirm button runs, so there's nothing to
 *  preserve across the switch. */
export function CropStage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CropMode>('draw');

  return (
    <div className="crop-stage-shell">
      <Segmented<CropMode>
        options={[
          { value: 'draw', label: t('builder.cropModeDraw') },
          { value: 'countries', label: t('builder.cropModeCountries') },
          { value: 'cities', label: t('builder.cropModeCities') },
        ]}
        value={mode}
        onChange={setMode}
        ariaLabel={t('builder.cropModeToggle')}
      />
      <div className="crop-stage-body">
        {mode === 'draw' && <CropDrawStage />}
        {mode === 'countries' && <CountryPickStage />}
        {mode === 'cities' && <CityPickStage />}
      </div>
    </div>
  );
}
