import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { CanvasControls } from '../CanvasControls';
import { ZoomVar } from '../ZoomVar';
import { useEditorStore } from '../store';
import { TAIWAN_CITIES } from '../../geo/taiwanCities';
import { citiesToGeography } from '../../geo/world';
import { CityList } from './CityList';

/** A Taiwan-only viewbox (lon 117.8–122.3, lat 21.7–26.5) rather than CountryPickStage's whole
 *  world: the divisions all sit here, and offshore Kinmen (~118.3°E), Matsu (~26.4°N) and the
 *  Taitung islands (~21.9°N) fit with a small margin. SVG y is -lat (north up). */
const TAIWAN_VIEWBOX = { x: 117.8, y: -26.5, w: 4.5, h: 4.8 };

/** The city-level parallel of CountryPickStage: pick one or more of Taiwan's 縣市 (by map click or
 *  the sidebar list) and get their combined silhouette, optionally with the internal county borders
 *  traced. Confirms into the same draft.geography every other crop mode feeds. */
export function CityPickStage() {
  const { t } = useTranslation();
  const setGeography = useEditorStore((s) => s.setGeography);
  const setStage = useEditorStore((s) => s.setStage);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [showBorders, setShowBorders] = useState(false);
  const zoomVarRef = useRef<HTMLDivElement | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const result = useMemo(
    () => (selected.size > 0 ? citiesToGeography([...selected], showBorders) : null),
    [selected, showBorders],
  );

  const confirm = () => {
    if (!result) return;
    setGeography(result.geography);
    setStage('trim');
  };

  return (
    <div className="editor-stage-layout">
      <div className="editor-canvas-wrap">
        <div className="editor-canvas-inner" ref={zoomVarRef}>
          <TransformWrapper
            minScale={1}
            maxScale={64}
            initialScale={1}
            centerOnInit
            wheel={{ step: 0.0022 }}
            doubleClick={{ disabled: true }}
          >
            <ZoomVar targetRef={zoomVarRef} />
            <CanvasControls />
            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <svg
                className="board editor-world editor-country-pick"
                viewBox={`${TAIWAN_VIEWBOX.x} ${TAIWAN_VIEWBOX.y} ${TAIWAN_VIEWBOX.w} ${TAIWAN_VIEWBOX.h}`}
                role="img"
                aria-label={t('builder.cropTaiwan')}
              >
                <rect
                  x={TAIWAN_VIEWBOX.x}
                  y={TAIWAN_VIEWBOX.y}
                  width={TAIWAN_VIEWBOX.w}
                  height={TAIWAN_VIEWBOX.h}
                  className="editor-world-sea"
                />
                {TAIWAN_CITIES.map((c) => (
                  <path
                    key={c.id}
                    data-city-id={c.id}
                    d={c.rings
                      .map((ring) => `M ${ring.map(([lon, lat]) => `${lon},${-lat}`).join(' L ')} Z`)
                      .join(' ')}
                    className={`editor-country${selected.has(c.id) ? ' editor-country--selected' : ''}`}
                    onClick={() => toggle(c.id)}
                  />
                ))}
              </svg>
            </TransformComponent>
          </TransformWrapper>
        </div>
        <p className="muted editor-hint">{t('builder.cityPickEmptyHint')}</p>
      </div>
      <aside className="card stack editor-inspector">
        <h3>{t('builder.cropPreview')}</h3>
        <label className="row editor-border-toggle">
          <input
            type="checkbox"
            checked={showBorders}
            onChange={(e) => setShowBorders(e.target.checked)}
          />
          {t('builder.showCityBorders')}
        </label>
        <CityList selected={selected} onToggle={toggle} />
        {selected.size > 0 && (
          <p className="muted">{t('builder.citySelectedCount', { n: selected.size })}</p>
        )}
        {result ? (
          <>
            <svg
              viewBox={`${result.geography.baseView.x} ${result.geography.baseView.y} ${result.geography.baseView.w} ${result.geography.baseView.h}`}
              className="editor-crop-preview-svg"
              role="img"
              aria-label={t('builder.cropPreview')}
            >
              <rect
                x={result.geography.baseView.x}
                y={result.geography.baseView.y}
                width={result.geography.baseView.w}
                height={result.geography.baseView.h}
                className="editor-world-sea"
              />
              {result.geography.land.map((ring, i) => (
                <path
                  key={i}
                  d={`M ${ring.map(([x, y]) => `${x},${y}`).join(' L ')} Z`}
                  className="editor-world-land"
                />
              ))}
              {result.geography.borders?.map((ring, i) => (
                <path
                  key={`border-${i}`}
                  d={`M ${ring.map(([x, y]) => `${x},${y}`).join(' L ')} Z`}
                  className="editor-world-border"
                />
              ))}
            </svg>
            {result.droppedRings > 0 && (
              <p className="muted">{t('builder.cropDropped', { n: result.droppedRings })}</p>
            )}
            <div className="row">
              <button className="primary" onClick={confirm}>
                {t('builder.cropConfirm')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('builder.cityPreviewEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
