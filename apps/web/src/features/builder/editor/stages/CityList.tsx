import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TAIWAN_CITIES } from '../../geo/taiwanCities';

export interface CityListProps {
  selected: ReadonlySet<string>;
  onToggle(id: string): void;
}

/** Searchable list of Taiwan's 縣市 — the precision on-ramp for CityPickStage's map click, for the
 *  small municipalities (e.g. Chiayi City, Keelung) that are awkward to hit at map zoom. Flat (a
 *  single country's divisions), rendered in TAIWAN_CITIES' own north→south order — no grouping like
 *  CountryList's continents. Filters by Chinese/English name or ISO 3166-2 id. */
export function CityList({ selected, onToggle }: CityListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TAIWAN_CITIES;
    return TAIWAN_CITIES.filter(
      (c) =>
        c.nameZh.includes(query.trim()) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.id.toLowerCase() === q,
    );
  }, [query]);

  return (
    <div className="country-list stack">
      <input
        type="text"
        className="country-list-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('builder.citySearchPlaceholder')}
        aria-label={t('builder.citySearchPlaceholder')}
      />
      <div className="country-list-groups">
        {matches.map((c) => (
          <label key={c.id} className="country-list-row">
            <input type="checkbox" checked={selected.has(c.id)} onChange={() => onToggle(c.id)} />
            {c.nameZh} <span className="muted">({c.nameEn})</span>
          </label>
        ))}
      </div>
    </div>
  );
}
