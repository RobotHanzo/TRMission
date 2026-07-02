import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dices, Trash2, Wand2 } from 'lucide-react';
import { generateTickets } from '@trm/map-data';
import { Segmented } from '../../../../components/ui/Segmented';
import { Dropdown, type DropdownOption } from '../../../../components/ui/Dropdown';
import { useEditorStore } from '../store';
import { draftToContent } from '../contentAdapter';
import type { CityDraft, TicketDraft } from '../../../../net/rest';

/** generateTickets returns branded TicketDef[]; the editor's draft (and the wire) use plain
 *  strings — this is the one place that boundary is crossed, right after generation. */
function ticketsToDraft(tickets: ReturnType<typeof generateTickets>): TicketDraft[] {
  return tickets.map((tk) => ({
    id: tk.id as string,
    a: tk.a as string,
    b: tk.b as string,
    value: tk.value,
    deck: tk.deck,
  }));
}

let nextTicketCounter = 0;
const newTicketId = (): string => `t${Date.now().toString(36)}${(nextTicketCounter++).toString(36)}`;

export function MissionsStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const addTicket = useEditorStore((s) => s.addTicket);
  const removeTicket = useEditorStore((s) => s.removeTicket);
  const replaceTickets = useEditorStore((s) => s.replaceTickets);
  const [deck, setDeck] = useState<'LONG' | 'SHORT'>('SHORT');
  const [genOpen, setGenOpen] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [value, setValue] = useState(2);

  const rows = draft.tickets.filter((tk) => tk.deck === deck);
  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;
  const cityOptions: DropdownOption<string>[] = draft.cities.map((c: CityDraft) => ({
    value: c.id,
    label: c.nameZh,
  }));

  const addRow = () => {
    if (!a || !b || a === b) return;
    addTicket({ id: newTicketId(), a, b, value, deck });
    setA('');
    setB('');
  };

  return (
    <div className="editor-stage-layout editor-stage-layout--table">
      <div className="card stack">
        <div className="row between">
          <Segmented<'LONG' | 'SHORT'>
            options={[
              { value: 'SHORT', label: t('builder.short') },
              { value: 'LONG', label: t('builder.long') },
            ]}
            value={deck}
            onChange={setDeck}
            ariaLabel={t('builder.missions')}
          />
          <button onClick={() => setGenOpen(true)}>
            <Wand2 size={14} aria-hidden /> {t('builder.autoGenerate')}
          </button>
        </div>
        <table className="editor-ticket-table">
          <thead>
            <tr>
              <th>{t('builder.from')}</th>
              <th>{t('builder.to')}</th>
              <th>{t('builder.value')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((tk) => (
              <tr key={tk.id}>
                <td>{cityName(tk.a)}</td>
                <td>{cityName(tk.b)}</td>
                <td>{tk.value}</td>
                <td>
                  <button className="icon-btn" onClick={() => removeTicket(tk.id)} aria-label={t('builder.deleteTicket')}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="editor-ticket-cell">
                <Dropdown<string>
                  options={cityOptions}
                  value={a}
                  onChange={setA}
                  ariaLabel={t('builder.from')}
                  placeholder={t('builder.selectCity')}
                  searchable
                  searchPlaceholder={t('builder.searchCities')}
                  emptyLabel={t('builder.noCitiesFound')}
                />
              </td>
              <td className="editor-ticket-cell">
                <Dropdown<string>
                  options={cityOptions}
                  value={b}
                  onChange={setB}
                  ariaLabel={t('builder.to')}
                  placeholder={t('builder.selectCity')}
                  searchable
                  searchPlaceholder={t('builder.searchCities')}
                  emptyLabel={t('builder.noCitiesFound')}
                />
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  style={{ width: '4em' }}
                  value={value}
                  onChange={(e) => setValue(Math.max(1, Number(e.target.value) || 1))}
                />
              </td>
              <td>
                <button onClick={addRow}>{t('builder.addTicket')}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {genOpen && (
        <GenerateModal
          onClose={() => setGenOpen(false)}
          onApply={(tickets) => {
            replaceTickets(tickets);
            setGenOpen(false);
          }}
        />
      )}
    </div>
  );
}

function GenerateModal({
  onClose,
  onApply,
}: {
  onClose(): void;
  onApply(tickets: TicketDraft[]): void;
}) {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const nameZh = useEditorStore((s) => s.nameZh);
  const nameEn = useEditorStore((s) => s.nameEn);
  const [seed, setSeed] = useState(1);
  const [longCount, setLongCount] = useState(6);
  const [shortCount, setShortCount] = useState(24);
  const [preview, setPreview] = useState<TicketDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;

  const run = (nextSeed: number) => {
    setSeed(nextSeed);
    setError(null);
    try {
      const content = draftToContent(draft, { nameZh, nameEn });
      // generateTickets throws loudly if the graph isn't fully connected.
      const tickets = generateTickets(content.cities, content.routes, {
        seed: nextSeed,
        longCount,
        shortCount,
      });
      setPreview(ticketsToDraft(tickets));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stack" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{t('builder.autoGenerate')}</h3>
        <label>
          {t('builder.longCount')}
          <input
            type="number"
            min={1}
            value={longCount}
            onChange={(e) => setLongCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label>
          {t('builder.shortCount')}
          <input
            type="number"
            min={1}
            value={shortCount}
            onChange={(e) => setShortCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <div className="row">
          <span className="muted">{t('builder.seed', { seed })}</span>
          <button onClick={() => run(Math.floor(Math.random() * 1_000_000))}>
            <Dices size={14} aria-hidden /> {t('builder.reroll')}
          </button>
          <button onClick={() => run(seed)}>{t('builder.preview')}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {preview && (
          <div className="editor-generate-preview">
            <p className="muted">{t('builder.previewCount', { n: preview.length })}</p>
            <ul>
              {preview.slice(0, 8).map((tk) => (
                <li key={tk.id}>
                  {cityName(tk.a)} ↔ {cityName(tk.b)} ({tk.value})
                </li>
              ))}
              {preview.length > 8 && <li className="muted">…</li>}
            </ul>
          </div>
        )}
        <div className="row">
          <button className="primary" disabled={!preview} onClick={() => preview && onApply(preview)}>
            {t('builder.applyReplaceAll')}
          </button>
          <button onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}
