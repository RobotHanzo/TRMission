import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../../../../components/ui/Segmented';
import { CropDrawStage } from './CropDrawStage';
import { CountryPickStage } from './CountryPickStage';

type CropMode = 'draw' | 'countries';

/** Two on-ramps into the same draft.geography: draw a rectangle (CropDrawStage) or pick countries
 *  by click/search (CountryPickStage). Switching modes unmounts the other, discarding whatever
 *  unconfirmed selection it had — nothing commits to the store until that mode's own Confirm
 *  button runs, so there's nothing to preserve across the switch. */
export function CropStage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CropMode>('draw');

  return (
    <div className="crop-stage-shell">
      <Segmented<CropMode>
        options={[
          { value: 'draw', label: t('builder.cropModeDraw') },
          { value: 'countries', label: t('builder.cropModeCountries') },
        ]}
        value={mode}
        onChange={setMode}
        ariaLabel={t('builder.cropModeToggle')}
      />
      <div className="crop-stage-body">
        {mode === 'draw' ? <CropDrawStage /> : <CountryPickStage />}
      </div>
    </div>
  );
}
