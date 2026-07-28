import { useControls } from 'react-zoom-pan-pinch';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, LocateFixed } from 'lucide-react';
import type { BoardBounds } from '@trm/client-core/game/boardModel';
import { frameHome } from '../../../game/frameHome';

/** The builder canvases' zoom rail — same look and buttons as the live board's `MapControls`,
 *  minus the game-only "follow" toggle. Must render as a sibling of `TransformComponent`
 *  (inside `TransformWrapper`), never inside it, so its own scale stays fixed.
 *  `home` re-frames the authored network to the viewport on reset — the live board's
 *  behaviour — for the stages that draw one (Stops/Routes/Curves); the world crop/trim/
 *  country-pick stages have no stops of their own and keep the plain `resetTransform`. */
export function CanvasControls({ onReset, home }: { onReset?(): void; home?: BoardBounds }) {
  const { t } = useTranslation();
  const controls = useControls();
  const { zoomIn, zoomOut, resetTransform } = controls;
  return (
    <div className="map-controls">
      <button type="button" aria-label={t('zoomIn')} title={t('zoomIn')} onClick={() => zoomIn()}>
        <Plus size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('zoomOut')}
        title={t('zoomOut')}
        onClick={() => zoomOut()}
      >
        <Minus size={16} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t('resetView')}
        title={t('resetView')}
        onClick={() =>
          onReset ? onReset() : home ? frameHome(controls, 200, home) : resetTransform()
        }
      >
        <LocateFixed size={16} aria-hidden />
      </button>
    </div>
  );
}
