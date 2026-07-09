import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dices, Trash2, Wand2 } from 'lucide-react';
import { generateTickets } from '@trm/map-data';
import type { TicketView } from '@trm/map-data';
import { Segmented } from '../../../../components/ui/Segmented';
import { Dropdown, type DropdownOption } from '../../../../components/ui/Dropdown';
import { RoutePreview } from '../../../../components/RoutePreview';
import { useEditorStore } from '../store';
import { draftToContent } from '../contentAdapter';
import type { CityDraft, TicketDraft } from '../../../../net/rest';

type ViewMode = 'inherit' | 'full' | 'auto' | 'zoom';

const modeOf = (v?: TicketView): ViewMode => (v ? v.mode : 'inherit');
const levelOf = (v?: TicketView): number => (v && v.mode === 'zoom' ? v.level : 0.5);
/** Map a chosen mode (+ current level) to a TicketView, or undefined for "inherit". */
const toView = (mode: ViewMode, level: number): TicketView | undefined => {
  if (mode === 'inherit') return undefined;
  if (mode === 'zoom') return { mode: 'zoom', level };
  return { mode };
};

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
const newTicketId = (): string =>
  `t${Date.now().toString(36)}${(nextTicketCounter++).toString(36)}`;

export function MissionsStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const addTicket = useEditorStore((s) => s.addTicket);
  const removeTicket = useEditorStore((s) => s.removeTicket);
  const replaceTickets = useEditorStore((s) => s.replaceTickets);
  const setTicketView = useEditorStore((s) => s.setTicketView);
  const setDefaultTicketView = useEditorStore((s) => s.setDefaultTicketView);
  const [deck, setDeck] = useState<'LONG' | 'SHORT'>('SHORT');
  const [genOpen, setGenOpen] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [value, setValue] = useState(2);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const rows = draft.tickets.filter((tk) => tk.deck === deck);
  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;
  const cityOptions: DropdownOption<string>[] = draft.cities.map((c: CityDraft) => ({
    value: c.id,
    label: c.nameZh,
  }));

  const viewOptions: DropdownOption<ViewMode>[] = [
    { value: 'inherit', label: t('builder.displayInherit') },
    { value: 'full', label: t('builder.displayFull') },
    { value: 'auto', label: t('builder.displayAuto') },
    { value: 'zoom', label: t('builder.displayZoom') },
  ];
  // The map default IS the fallback, so it has no "inherit" option.
  const defaultViewOptions = viewOptions.filter((o) => o.value !== 'inherit');

  const renderViewControl = (
    current: TicketView | undefined,
    onChange: (v: TicketView | undefined) => void,
    options: DropdownOption<ViewMode>[],
    ariaLabel: string,
  ) => {
    const mode = modeOf(current);
    const level = levelOf(current);
    return (
      <div className="row" style={{ gap: '0.4em', alignItems: 'center' }}>
        <Dropdown<ViewMode>
          options={options}
          value={mode}
          onChange={(m) => onChange(toView(m, level))}
          ariaLabel={ariaLabel}
        />
        {mode === 'zoom' && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={level}
            aria-label={t('builder.zoomLevel')}
            onChange={(e) => onChange({ mode: 'zoom', level: Number(e.target.value) })}
          />
        )}
      </div>
    );
  };

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
        {draft.geography && (
          <div className="row between">
            <span className="muted">{t('builder.mapDefaultFraming')}</span>
            {renderViewControl(
              draft.geography.defaultTicketView,
              (v) => setDefaultTicketView(v),
              defaultViewOptions,
              t('builder.mapDefaultFraming'),
            )}
          </div>
        )}
        {/* Two searchable city dropdowns per row make the table intrinsically wider than a
            phone; like .scoreboard-scroll, it pans sideways inside the card instead of
            bleeding off-screen. */}
        <div className="editor-table-scroll">
          <table className="editor-ticket-table">
            <thead>
              <tr>
                <th>{t('builder.from')}</th>
                <th>{t('builder.to')}</th>
                <th>{t('builder.value')}</th>
                <th>{t('builder.displayArea')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((tk) => (
                <tr
                  key={tk.id}
                  onClick={() => setPreviewId(tk.id)}
                  className={previewId === tk.id ? 'is-selected' : undefined}
                >
                  <td>{cityName(tk.a)}</td>
                  <td>{cityName(tk.b)}</td>
                  <td>{tk.value}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {renderViewControl(
                      tk.view,
                      (v) => setTicketView(tk.id, v),
                      viewOptions,
                      t('builder.displayArea'),
                    )}
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      onClick={() => removeTicket(tk.id)}
                      aria-label={t('builder.deleteTicket')}
                    >
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
                <td />
                <td>
                  <button onClick={addRow}>{t('builder.addTicket')}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {(() => {
          const geo = draft.geography;
          const tk = draft.tickets.find((x) => x.id === previewId) ?? rows[0];
          const ca = tk && draft.cities.find((c) => c.id === tk.a);
          const cb = tk && draft.cities.find((c) => c.id === tk.b);
          if (!geo || !tk || !ca || !cb) {
            return <p className="muted">{t('builder.selectTicketToPreview')}</p>;
          }
          return (
            <div className="editor-ticket-preview">
              <span className="muted">{t('builder.ticketPreview')}</span>
              <div className="ticket-map">
                <RoutePreview
                  a={{ id: ca.id, x: ca.x, y: ca.y }}
                  b={{ id: cb.id, x: cb.x, y: cb.y }}
                  cities={draft.cities}
                  routes={draft.routes}
                  geography={geo}
                  baseView={geo.baseView}
                  view={tk.view}
                  tone={tk.deck === 'LONG' ? 'long' : 'short'}
                />
              </div>
            </div>
          );
        })()}
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
      <div
        className="modal stack"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
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
          <button
            className="primary"
            disabled={!preview}
            onClick={() => preview && onApply(preview)}
          >
            {t('builder.applyReplaceAll')}
          </button>
          <button onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </div>
  );
}
