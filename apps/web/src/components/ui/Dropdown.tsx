import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

interface PanelRect {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

/**
 * A self-drawn replacement for `<select>`: same keyboard/click semantics (Escape closes,
 * outside-click closes) but a paper-card popover that matches the app's design language and,
 * unlike a native select, can render rich option rows (colour swatches, etc).
 *
 * The open panel is portaled to `document.body` and positioned from the trigger's viewport rect
 * (`position: fixed`) rather than living inside `.dropdown` (`position: absolute`) — otherwise any
 * scrollable ancestor (e.g. the missions table's `.editor-main`) clips it once the panel would
 * extend past that ancestor's own visible box.
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
  const [panelRect, setPanelRect] = useState<PanelRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
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

  useLayoutEffect(() => {
    if (!open) {
      setPanelRect(null);
      return;
    }
    const reposition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const panelHeight = panelRef.current?.offsetHeight ?? 0;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = panelHeight > spaceBelow && rect.top > spaceBelow;
      const gap = 4;
      setPanelRect({
        top: openUp ? rect.top - gap : rect.bottom + gap,
        left: rect.left,
        width: rect.width,
        openUp,
      });
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, filtered.length]);

  return (
    <div className={open ? 'dropdown open' : 'dropdown'} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dropdown-trigger-value">
          {selected ? (
            (selected.render ?? selected.label)
          ) : (
            <span className="muted">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={14} aria-hidden className="dropdown-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="dropdown-panel"
            style={
              panelRect
                ? {
                    position: 'fixed',
                    top: panelRect.top,
                    left: panelRect.left,
                    width: panelRect.width,
                    transform: panelRect.openUp ? 'translateY(-100%)' : undefined,
                  }
                : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }
            }
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
