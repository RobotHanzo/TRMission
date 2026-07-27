import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type UserFilter, type UserRow } from '../net/rest';
import { SignalBadge } from './SignalBadge';
import { Copyable } from './CopyButton';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { shortId } from '../lib/fmt';

interface Props {
  title: string;
  onSelect: (user: UserRow) => void;
  onClose: () => void;
  /** Defaults to registered accounts — features and maintainer grants can only target them. */
  filter?: UserFilter;
  /** Accounts to hide (already granted / already maintainers). */
  excludeIds?: string[];
}

/** Search-as-you-type account picker over GET /dashboard/users (requires users.read). */
export function AccountSelectorModal({
  title,
  onSelect,
  onClose,
  filter = 'registered',
  excludeIds,
}: Props) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, q.trim() ? 300 : 0);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listUsers({ ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}), filter })
      .then((page) => {
        if (!cancelled) setRows(page.users);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const excluded = new Set(excludeIds ?? []);
  const visible = rows.filter((u) => !excluded.has(u.id));

  return (
    <div className="oc-modal-backdrop" onClick={onClose}>
      <div
        className="oc-modal oc-account-selector"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <input
          type="search"
          autoFocus
          placeholder={t('accountSelector.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')}
        />
        {/* Options, not buttons: the id and email inside each row carry their own copy
            buttons, which may not nest inside a <button>. */}
        <div className="oc-account-list" role="listbox" aria-label={title}>
          {visible.map((u) => (
            <div
              key={u.id}
              role="option"
              aria-selected={false}
              tabIndex={0}
              className="oc-account-row"
              onClick={() => onSelect(u)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(u);
                }
              }}
            >
              <span className="name">{u.displayName}</span>
              <Copyable value={u.id} display={shortId(u.id)} label="ID" muted />
              {u.email && (
                <Copyable
                  value={u.email}
                  label={t('users.colEmail')}
                  mono={false}
                  muted
                  className="email"
                />
              )}
              {u.disabledAt && <SignalBadge aspect="stop" label={t('users.disabledBadge')} />}
            </div>
          ))}
          {visible.length === 0 && (
            <div className="oc-empty">{loading ? t('common.loading') : t('common.empty')}</div>
          )}
        </div>
        <div className="oc-modal-actions">
          <button className="oc-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
