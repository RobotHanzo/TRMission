import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';

interface StarRatingProps {
  value: number;
  onChange: (stars: number) => void;
  size?: number;
  disabled?: boolean;
}

/** Five-star picker. `value` is 0-5 (0 = none selected yet). */
export function StarRating({ value, onChange, size = 32, disabled = false }: StarRatingProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(0);
  const display = hovered || value;

  return (
    <div className="star-rating" role="radiogroup" aria-label={t('rateAppPrompt')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="star-rating-star"
          role="radio"
          aria-checked={value === n}
          aria-label={t('starRatingValue', { n })}
          disabled={disabled}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}
        >
          <Star size={size} fill={n <= display ? 'currentColor' : 'none'} aria-hidden />
        </button>
      ))}
    </div>
  );
}
