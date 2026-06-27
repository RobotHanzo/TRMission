import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketLabel } from '../game/content';
import { useUi } from '../store/ui';

interface Props {
  offered: string[];
  minKeep: number;
  onConfirm(ids: string[]): void;
}

export function KeepTicketsModal({ offered, minKeep, onConfirm }: Props) {
  const { t } = useTranslation();
  const locale = useUi((s) => s.locale);
  const [kept, setKept] = useState<Set<string>>(() => new Set(offered)); // default: keep all

  const toggle = (id: string) =>
    setKept((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h3>{t('chooseTickets')}</h3>
        <p className="muted">{t('keepAtLeast', { n: minKeep })}</p>
        <ul className="ticket-choices">
          {offered.map((id) => {
            const l = ticketLabel(id, locale);
            if (!l) return null;
            return (
              <li key={id}>
                <label className={kept.has(id) ? 'chosen' : ''}>
                  <input type="checkbox" checked={kept.has(id)} onChange={() => toggle(id)} />
                  <span>
                    {l.a} – {l.b}
                  </span>
                  <b>{l.value}</b>
                  {l.long && <em> ★</em>}
                </label>
              </li>
            );
          })}
        </ul>
        <button
          className="primary"
          disabled={kept.size < minKeep}
          onClick={() => onConfirm([...kept])}
        >
          {t('keep')}
        </button>
      </div>
    </div>
  );
}
