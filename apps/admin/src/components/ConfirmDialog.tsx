import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** When set, shows an optional free-text reason field passed to onConfirm. */
  withReason?: boolean;
  busy?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

/** Modal confirm with optional reason input. Escape cancels; focus starts on cancel. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  withReason,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="oc-modal-backdrop" onClick={onCancel}>
      <div
        className="oc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{body}</p>
        {withReason && (
          <textarea
            value={reason}
            maxLength={500}
            placeholder={t('common.reason')}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <div className="oc-modal-actions">
          <button ref={cancelRef} className="oc-btn" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            className={`oc-btn ${danger ? 'danger' : 'primary'}`}
            onClick={() => onConfirm(reason.trim() || undefined)}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
