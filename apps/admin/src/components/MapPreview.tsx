import { useTranslation } from 'react-i18next';

interface PreviewCity {
  id: string;
  x: number;
  y: number;
}
interface PreviewRoute {
  a: string;
  b: string;
}

/** Read-only board-shape glance for moderation: cities as dots, routes as lines, in the
 *  draft's own 0-100 coordinate space. No interactivity, no dependency on the game's real
 *  board renderer (apps/web) — this is inert content, not live game state. */
export function MapPreview({
  draft,
}: {
  draft: { cities: PreviewCity[]; routes: PreviewRoute[] };
}) {
  const { t } = useTranslation();
  if (draft.cities.length === 0) {
    return <p className="oc-muted">{t('maps.previewEmpty')}</p>;
  }
  const byId = new Map(draft.cities.map((c) => [c.id, c]));
  return (
    <svg viewBox="0 0 100 100" className="oc-map-preview" role="img" aria-label={t('maps.preview')}>
      {draft.routes.map((r, i) => {
        const a = byId.get(r.a);
        const b = byId.get(r.b);
        if (!a || !b) return null;
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={0.4} />;
      })}
      {draft.cities.map((c) => (
        <circle key={c.id} cx={c.x} cy={c.y} r={1.2} fill="currentColor" />
      ))}
    </svg>
  );
}
