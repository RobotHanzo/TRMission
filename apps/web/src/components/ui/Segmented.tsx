import type { LucideIcon } from 'lucide-react';

interface Option<T> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange(next: T): void;
  ariaLabel: string;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: Props<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={value === v ? 'segment active' : 'segment'}
          onClick={() => onChange(v)}
        >
          {Icon && <Icon size={16} aria-hidden />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
