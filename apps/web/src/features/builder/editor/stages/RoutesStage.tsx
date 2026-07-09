import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { TRAIN_COLORS, ROUTE_LENGTHS } from '@trm/shared';
import type { RouteColor, RouteLength } from '@trm/shared';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../../../theme/colors';
import { Dropdown, type DropdownOption } from '../../../../components/ui/Dropdown';
import { Segmented } from '../../../../components/ui/Segmented';
import { Switch } from '../../../../components/ui/Switch';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore, newRouteId } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const ROUTE_COLORS: readonly RouteColor[] = [...TRAIN_COLORS, 'GRAY'];

export function RoutesStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const addRoute = useEditorStore((s) => s.addRoute);
  const updateRoute = useEditorStore((s) => s.updateRoute);
  const removeRoute = useEditorStore((s) => s.removeRoute);
  const setPairTrackCount = useEditorStore((s) => s.setPairTrackCount);
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [draftPair, setDraftPair] = useState<{ a: string; b: string } | null>(null);

  const selectedRoute =
    selection?.kind === 'route' ? draft.routes.find((r) => r.id === selection.id) : undefined;

  const highlight = new Set<string>();
  if (pendingFrom) highlight.add(pendingFrom);
  if (draftPair) {
    highlight.add(draftPair.a);
    highlight.add(draftPair.b);
  }

  const cityName = (id: string): string => draft.cities.find((c) => c.id === id)?.nameZh ?? id;

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <EditorCanvas
          highlightCities={highlight}
          onCityClick={(id) => {
            select(null);
            if (!pendingFrom) {
              setPendingFrom(id);
              return;
            }
            if (id === pendingFrom) {
              setPendingFrom(null);
              return;
            }
            const existing = draft.routes.find(
              (r) => (r.a === pendingFrom && r.b === id) || (r.a === id && r.b === pendingFrom),
            );
            setPendingFrom(null);
            if (existing) {
              select({ kind: 'route', id: existing.id });
              return;
            }
            setDraftPair({ a: pendingFrom, b: id });
          }}
          onRouteClick={(id) => {
            setPendingFrom(null);
            setDraftPair(null);
            select({ kind: 'route', id });
          }}
          onBackgroundClick={() => {
            setPendingFrom(null);
            setDraftPair(null);
            select(null);
          }}
        />
        <p className="muted editor-hint">
          {pendingFrom ? t('builder.routesHintSecond') : t('builder.routesHintFirst')}
        </p>
      </div>
      <aside className="card stack editor-inspector">
        {draftPair ? (
          <RouteForm
            title={t('builder.newRoute', { a: cityName(draftPair.a), b: cityName(draftPair.b) })}
            initial={{
              id: newRouteId(),
              a: draftPair.a,
              b: draftPair.b,
              color: 'RED',
              length: 2,
              ferryLocos: 0,
              isTunnel: false,
            }}
            onCancel={() => setDraftPair(null)}
            onSubmit={(newRoute, trackCount) => {
              addRoute(newRoute);
              if (trackCount > 1) setPairTrackCount(newRoute.id, trackCount as 2 | 3);
              setDraftPair(null);
            }}
          />
        ) : selectedRoute ? (
          <RouteForm
            title={t('builder.editRoute', {
              a: cityName(selectedRoute.a),
              b: cityName(selectedRoute.b),
            })}
            initial={selectedRoute}
            hideDouble
            onCancel={() => select(null)}
            onSubmit={(route) => updateRoute(selectedRoute.id, route)}
            extra={
              <>
                <div className="field">
                  <span className="field-label">{t('builder.parallelTracks')}</span>
                  <Segmented<string>
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '3', label: '3' },
                    ]}
                    value={String(
                      Math.min(
                        3,
                        draft.routes.filter(
                          (r) =>
                            (r.a === selectedRoute.a && r.b === selectedRoute.b) ||
                            (r.a === selectedRoute.b && r.b === selectedRoute.a),
                        ).length,
                      ),
                    )}
                    onChange={(v) => setPairTrackCount(selectedRoute.id, Number(v) as 1 | 2 | 3)}
                    ariaLabel={t('builder.parallelTracks')}
                  />
                </div>
                <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                  <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
                </button>
              </>
            }
          />
        ) : (
          <p className="muted">{t('builder.routesEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}

function RouteForm({
  title,
  initial,
  hideDouble,
  onCancel,
  onSubmit,
  extra,
}: {
  title: string;
  initial: RouteDraft;
  hideDouble?: boolean;
  onCancel(): void;
  onSubmit(route: RouteDraft, trackCount: number): void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Builder-authored data always conforms to these unions by construction (the <select>s below
  // only ever offer valid options) — the wire/store type is a plain string for JSON round-tripping.
  const [color, setColor] = useState<RouteColor>(initial.color as RouteColor);
  const [length, setLength] = useState<RouteLength>(initial.length as RouteLength);
  const [isTunnel, setIsTunnel] = useState(initial.isTunnel);
  const [ferryLocos, setFerryLocos] = useState(initial.ferryLocos);
  const [trackCount, setTrackCount] = useState(1);
  const isFerry = ferryLocos > 0;

  const colorOptions: DropdownOption<RouteColor>[] = ROUTE_COLORS.map((c) => {
    const token = c === 'GRAY' ? GRAY_TOKEN : CARD_COLOR_TOKENS[c];
    return {
      value: c,
      label: token.nameZh,
      render: (
        <span className="row color-option">
          <span className="color-swatch" style={{ background: token.hex }} aria-hidden />
          {token.nameZh}
        </span>
      ),
    };
  });

  return (
    <>
      <h3>{title}</h3>
      <label className="field">
        <span className="field-label">{t('builder.routeLength')}</span>
        <Segmented<string>
          options={ROUTE_LENGTHS.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(length)}
          onChange={(v) => setLength(Number(v) as RouteLength)}
          ariaLabel={t('builder.routeLength')}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('builder.routeColor')}</span>
        <Dropdown<RouteColor>
          options={colorOptions}
          value={color}
          onChange={setColor}
          ariaLabel={t('builder.routeColor')}
          disabled={isFerry}
        />
      </label>
      <div className="row between setting-row">
        <span className="field-label">{t('builder.isTunnel')}</span>
        <Switch
          checked={isTunnel}
          disabled={isFerry}
          onChange={setIsTunnel}
          label={t('builder.isTunnel')}
        />
      </div>
      <label className="field">
        <span className="field-label">{t('builder.ferryLocos')}</span>
        <input
          type="number"
          min={0}
          max={length}
          value={ferryLocos}
          onChange={(e) => {
            const n = Math.max(0, Math.min(length, Number(e.target.value) || 0));
            setFerryLocos(n);
            if (n > 0) {
              setColor('GRAY');
              setIsTunnel(false);
            }
          }}
        />
      </label>
      {!hideDouble && (
        <div className="field">
          <span className="field-label">{t('builder.parallelTracks')}</span>
          <Segmented<string>
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            value={String(trackCount)}
            onChange={(v) => setTrackCount(Number(v))}
            ariaLabel={t('builder.parallelTracks')}
          />
        </div>
      )}
      <div className="row">
        <button
          className="primary"
          onClick={() => onSubmit({ ...initial, color, length, isTunnel, ferryLocos }, trackCount)}
        >
          {t('save')}
        </button>
        <button onClick={onCancel}>{t('cancel')}</button>
      </div>
      {extra}
    </>
  );
}
