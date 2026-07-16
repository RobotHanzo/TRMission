import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { CanvasControls } from '../CanvasControls';
import { ZoomVar } from '../ZoomVar';
import { useEditorStore } from '../store';
import { WORLD_COUNTRIES } from '../../geo/worldCountries';
import { countriesToGeography } from '../../geo/world';
import { CountryList } from './CountryList';

const WORLD_VIEWBOX = { x: -180, y: -90, w: 360, h: 180 };
/** Same rationale as the existing 60°-latitude crop warning (a third of that axis's ±90° range);
 *  applied to longitude's ±180° range so a Taiwan+Brazil-style pick — mostly empty ocean between
 *  two selections — gets the same "this will distort" nudge a too-tall manual crop already gets. */
const LON_SPAN_WARNING = 120;
const LAT_SPAN_WARNING = 60;

export function CountryPickStage() {
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
    () => (selected.size > 0 ? countriesToGeography([...selected], showBorders) : null),
    [selected, showBorders],
  );
  const crop = result?.geography.crop;
  const lonSpan = crop ? crop.lonMax - crop.lonMin : 0;
  const latSpan = crop ? crop.latMax - crop.latMin : 0;

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
                viewBox={`${WORLD_VIEWBOX.x} ${WORLD_VIEWBOX.y} ${WORLD_VIEWBOX.w} ${WORLD_VIEWBOX.h}`}
                role="img"
                aria-label={t('builder.cropWorld')}
              >
                <rect x={-180} y={-90} width={360} height={180} className="editor-world-sea" />
                {WORLD_COUNTRIES.map((c) => (
                  <path
                    key={c.id}
                    data-country-id={c.id}
                    d={c.rings
                      .map(
                        (ring) => `M ${ring.map(([lon, lat]) => `${lon},${-lat}`).join(' L ')} Z`,
                      )
                      .join(' ')}
                    className={`editor-country${selected.has(c.id) ? ' editor-country--selected' : ''}`}
                    onClick={() => toggle(c.id)}
                  />
                ))}
              </svg>
            </TransformComponent>
          </TransformWrapper>
        </div>
        <p className="muted editor-hint">{t('builder.countryPickEmptyHint')}</p>
        {latSpan > LAT_SPAN_WARNING && (
          <p className="error editor-hint editor-hint--warning">{t('builder.cropLatWarning')}</p>
        )}
        {lonSpan > LON_SPAN_WARNING && (
          <p className="error editor-hint editor-hint--warning">{t('builder.countryLonWarning')}</p>
        )}
      </div>
      <aside className="card stack editor-inspector">
        <h3>{t('builder.cropPreview')}</h3>
        <label className="row editor-border-toggle">
          <input
            type="checkbox"
            checked={showBorders}
            onChange={(e) => setShowBorders(e.target.checked)}
          />
          {t('builder.showCountryBorders')}
        </label>
        <CountryList selected={selected} onToggle={toggle} />
        {selected.size > 0 && (
          <p className="muted">{t('builder.countrySelectedCount', { n: selected.size })}</p>
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
          <p className="muted">{t('builder.countryPreviewEmptyHint')}</p>
        )}
      </aside>
    </div>
  );
}
