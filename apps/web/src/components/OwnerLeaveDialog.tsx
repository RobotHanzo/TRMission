import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomMember } from '../net/rest';

interface OwnerLeaveDialogProps {
  candidates: RoomMember[];
  onTransfer: (userId: string) => void;
  onClose: () => void;
  onCancel: () => void;
}

/** Shown when the room owner leaves with other human players present: hand ownership to a
 *  chosen member (then leave), or close the whole room for everyone. */
export function OwnerLeaveDialog({
  candidates,
  onTransfer,
  onClose,
  onCancel,
}: OwnerLeaveDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>(candidates[0]?.userId ?? '');

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-leave-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="owner-leave-title">{t('ownerLeaveTitle')}</h3>
        <p>{t('ownerLeaveBody')}</p>
        <fieldset className="stack">
          <legend>{t('selectNewOwner')}</legend>
          {candidates.map((m) => (
            <label key={m.userId} className="row">
              <input
                type="radio"
                name="new-owner"
                value={m.userId}
                checked={selected === m.userId}
                onChange={() => setSelected(m.userId)}
              />
              <span>{m.displayName}</span>
            </label>
          ))}
        </fieldset>
        <div className="row">
          <button type="button" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className="danger" onClick={onClose}>
            {t('closeRoom')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!selected}
            onClick={() => onTransfer(selected)}
          >
            {t('transferAndLeave')}
          </button>
        </div>
      </div>
    </div>
  );
}
