import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { TRAIN_COLORS, ROUTE_LENGTHS } from '@trm/shared';
import type { RouteColor, RouteLength } from '@trm/shared';
import { CARD_COLOR_TOKENS, GRAY_TOKEN } from '../../../../theme/colors';
import { EditorCanvas } from '../EditorCanvas';
import { useEditorStore } from '../store';
import type { RouteDraft } from '../../../../net/rest';

const ROUTE_COLORS: readonly RouteColor[] = [...TRAIN_COLORS, 'GRAY'];
let nextRouteCounter = 0;
const newRouteId = (): string => `r${Date.now().toString(36)}${(nextRouteCounter++).toString(36)}`;

export function RoutesStage() {
  const { t } = useTranslation();
  const draft = useEditorStore((s) => s.draft);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const addRoute = useEditorStore((s) => s.addRoute);
  const updateRoute = useEditorStore((s) => s.updateRoute);
  const removeRoute = useEditorStore((s) => s.removeRoute);
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
            setDraftPair({ a: pendingFrom, b: id });
            setPendingFrom(null);
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
            existingDoubleGroups={[...new Set(draft.routes.map((r) => r.doubleGroup).filter(Boolean))] as string[]}
            onCancel={() => setDraftPair(null)}
            onSubmit={(route, makeDouble) => {
              addRoute(route);
              if (makeDouble) {
                // route.doubleGroup is already set by RouteForm whenever makeDouble is true —
                // the spread carries it through, the sibling only needs a fresh id and colour.
                addRoute({ ...route, id: newRouteId(), color: route.color === 'RED' ? 'BLUE' : 'RED' });
              }
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
            existingDoubleGroups={[]}
            hideDouble
            onCancel={() => select(null)}
            onSubmit={(route) => updateRoute(selectedRoute.id, route)}
            extra={
              <button className="danger" onClick={() => removeRoute(selectedRoute.id)}>
                <Trash2 size={14} aria-hidden /> {t('builder.deleteRoute')}
              </button>
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
  existingDoubleGroups,
  hideDouble,
  onCancel,
  onSubmit,
  extra,
}: {
  title: string;
  initial: RouteDraft;
  existingDoubleGroups: string[];
  hideDouble?: boolean;
  onCancel(): void;
  onSubmit(route: RouteDraft, makeDouble: boolean): void;
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Builder-authored data always conforms to these unions by construction (the <select>s below
  // only ever offer valid options) — the wire/store type is a plain string for JSON round-tripping.
  const [color, setColor] = useState<RouteColor>(initial.color as RouteColor);
  const [length, setLength] = useState<RouteLength>(initial.length as RouteLength);
  const [isTunnel, setIsTunnel] = useState(initial.isTunnel);
  const [ferryLocos, setFerryLocos] = useState(initial.ferryLocos);
  const [makeDouble, setMakeDouble] = useState(false);
  const isFerry = ferryLocos > 0;

  const nextDoubleGroup = (): string => {
    const letters = 'ABCDEFGHIJ';
    for (const l of letters) if (!existingDoubleGroups.includes(l)) return l;
    return 'A';
  };

  return (
    <>
      <h3>{title}</h3>
      <label>
        {t('builder.routeLength')}
        <select value={length} onChange={(e) => setLength(Number(e.target.value) as RouteLength)}>
          {ROUTE_LENGTHS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('builder.routeColor')}
        <select
          value={color}
          onChange={(e) => setColor(e.target.value as RouteColor)}
          disabled={isFerry}
        >
          {ROUTE_COLORS.map((c) => (
            <option key={c} value={c}>
              {c === 'GRAY' ? GRAY_TOKEN.nameZh : CARD_COLOR_TOKENS[c].nameZh}
            </option>
          ))}
        </select>
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={isTunnel}
          disabled={isFerry}
          onChange={(e) => setIsTunnel(e.target.checked)}
        />
        {t('builder.isTunnel')}
      </label>
      <label>
        {t('builder.ferryLocos')}
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
        <label className="row">
          <input type="checkbox" checked={makeDouble} onChange={(e) => setMakeDouble(e.target.checked)} />
          {t('builder.makeDouble')}
        </label>
      )}
      <div className="row">
        <button
          className="primary"
          onClick={() =>
            onSubmit(
              {
                ...initial,
                color,
                length,
                isTunnel,
                ferryLocos,
                ...(makeDouble ? { doubleGroup: nextDoubleGroup() } : {}),
              },
              makeDouble,
            )
          }
        >
          {t('save')}
        </button>
        <button onClick={onCancel}>{t('cancel')}</button>
      </div>
      {extra}
    </>
  );
}
