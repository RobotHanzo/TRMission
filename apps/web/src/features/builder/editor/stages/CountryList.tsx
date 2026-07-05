import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORLD_COUNTRIES, type CountryLand } from '../../geo/worldCountries';

const CONTINENT_KEY: Record<string, string> = {
  Africa: 'builder.continentAfrica',
  Asia: 'builder.continentAsia',
  Europe: 'builder.continentEurope',
  'North America': 'builder.continentNorthAmerica',
  'South America': 'builder.continentSouthAmerica',
  Oceania: 'builder.continentOceania',
};
const CONTINENT_ORDER = Object.keys(CONTINENT_KEY);

export interface CountryListProps {
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
}

/** Searchable, continent-grouped country picker — the precision on-ramp for CountryPickStage's
 *  map click, for countries too small to reliably click at world-map zoom. Countries within each
 *  continent are already alphabetical by English name (WORLD_COUNTRIES is generated sorted that
 *  way), so no further sort is needed here. */
export function CountryList({ selected, onToggle }: CountryListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? WORLD_COUNTRIES.filter(
          (c) =>
            c.nameZh.includes(query.trim()) ||
            c.nameEn.toLowerCase().includes(q) ||
            c.id.toLowerCase() === q,
        )
      : WORLD_COUNTRIES;
    const byContinent = new Map<string, CountryLand[]>();
    for (const c of matches) {
      const list = byContinent.get(c.continent) ?? [];
      list.push(c);
      byContinent.set(c.continent, list);
    }
    return CONTINENT_ORDER.map((continent) => ({
      continent,
      countries: byContinent.get(continent) ?? [],
    })).filter((g) => g.countries.length > 0);
  }, [query]);

  return (
    <div className="country-list stack">
      <input
        type="text"
        className="country-list-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('builder.countrySearchPlaceholder')}
        aria-label={t('builder.countrySearchPlaceholder')}
      />
      <div className="country-list-groups">
        {groups.map(({ continent, countries }) => (
          <div key={continent} className="country-list-group">
            <h4 className="country-list-continent">{t(CONTINENT_KEY[continent]!)}</h4>
            {countries.map((c) => (
              <label key={c.id} className="country-list-row">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => onToggle(c.id)}
                />
                {c.nameZh} <span className="muted">({c.nameEn})</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
