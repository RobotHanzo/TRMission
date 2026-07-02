import { useControls } from 'react-zoom-pan-pinch';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, LocateFixed } from 'lucide-react';

/** The builder canvases' zoom rail — same look and buttons as the live board's `MapControls`,
 *  minus the game-only "follow" toggle. Must render as a sibling of `TransformComponent`
 *  (inside `TransformWrapper`), never inside it, so its own scale stays fixed. */
export function CanvasControls({ onReset }: { onReset?(): void }) {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="map-controls">
      <button type="button" aria-label={t('zoomIn')} title={t('zoomIn')} onClick={() => zoomIn()}>
        <Plus size={16} aria-hidden />
      </button>
      <button type="button" aria-label={t('zoomOut')} title={t('zoomOut')} onClick={() => zoomOut()}>
        <Minus size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('resetView')}
        title={t('resetView')}
        onClick={() => (onReset ? onReset() : resetTransform())}
      >
        <LocateFixed size={16} aria-hidden />
      </button>
    </div>
  );
}
