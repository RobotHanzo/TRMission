import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Custom row/trigger content (e.g. a colour swatch) — falls back to `label` when omitted. */
  render?: ReactNode;
}

interface Props<T extends string> {
  options: readonly DropdownOption<T>[];
  value: T;
  onChange(next: T): void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
}

/**
 * A self-drawn replacement for `<select>`: same keyboard/click semantics (Escape closes,
 * outside-click closes) but a paper-card popover that matches the app's design language and,
 * unlike a native select, can render rich option rows (colour swatches, etc).
 */
export function Dropdown<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder,
  disabled,
  searchable,
  searchPlaceholder,
  emptyLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery('');
  }, [open]);

  const filtered =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;

  return (
    <div className={open ? 'dropdown open' : 'dropdown'} ref={rootRef}>
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dropdown-trigger-value">
          {selected ? (selected.render ?? selected.label) : <span className="muted">{placeholder}</span>}
        </span>
        <ChevronDown size={14} aria-hidden className="dropdown-chevron" />
      </button>
      {open && (
        <div className="dropdown-panel">
          {searchable && (
            <div className="dropdown-search">
              <Search size={13} aria-hidden />
              <input
                ref={searchRef}
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <div className="dropdown-list" role="listbox" aria-label={ariaLabel}>
            {filtered.length === 0 && <div className="dropdown-empty muted">{emptyLabel}</div>}
            {filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={o.value === value ? 'dropdown-option selected' : 'dropdown-option'}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.render ?? o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
