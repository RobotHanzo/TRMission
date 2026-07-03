import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Right-side detail drawer over a list view — list context is never lost. */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="oc-drawer-backdrop" onClick={onClose} />
      <aside className="oc-drawer" role="dialog" aria-label={title}>
        <div className="oc-drawer-head">
          <h2>{title}</h2>
          <button className="oc-icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="oc-drawer-body">{children}</div>
      </aside>
    </>
  );
}
