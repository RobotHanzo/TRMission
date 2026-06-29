// A non-blocking focus scrim: dims the whole viewport and punches a lit, ringed hole around each
// spotlight target. pointer-events:none, so the learner can still click the highlighted element.
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FlatRect } from './focus';

const PAD = 10;
const RADIUS = 14;

function viewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export function TutorialSpotlight({
  rects,
  reducedMotion,
  dimAll = false,
}: {
  rects: FlatRect[];
  reducedMotion: boolean;
  /** Dim the whole stage when there are no cutouts. TRUE only when the beat intends no specific
   *  target (a whole-board overview, or a beat with no spotlight). When a beat DOES name a target
   *  but it hasn't resolved yet (or its selector missed), this stays false so we render nothing —
   *  dimming everything would hide the very element being taught. */
  dimAll?: boolean;
}) {
  const maskId = `tut-spot-mask-${useId().replace(/:/g, '')}`;
  const [vp, setVp] = useState(viewport);
  useEffect(() => {
    const onResize = (): void => setVp(viewport());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (typeof document === 'undefined') return null;
  const { w, h } = vp;
  const hasHoles = rects.length > 0;
  // No cutouts and no intent to dim the whole stage ⇒ render nothing (never dim the taught element).
  if (!hasHoles && !dimAll) return null;

  return createPortal(
    <div className={'tut-spotlight' + (hasHoles ? '' : ' is-global')} aria-hidden>
      <svg className="tut-spotlight-svg" width={w} height={h}>
        <defs>
          <mask id={maskId}>
            <rect x={0} y={0} width={w} height={h} fill="white" />
            {rects.map((r, i) => (
              <rect
                key={i}
                x={r.x - PAD}
                y={r.y - PAD}
                width={r.w + PAD * 2}
                height={r.h + PAD * 2}
                rx={RADIUS}
                ry={RADIUS}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          className="tut-spotlight-dim"
          x={0}
          y={0}
          width={w}
          height={h}
          mask={hasHoles ? `url(#${maskId})` : undefined}
        />
        {rects.map((r, i) => (
          <rect
            key={i}
            className={'tut-spotlight-ring' + (reducedMotion ? '' : ' pulse')}
            x={r.x - PAD}
            y={r.y - PAD}
            width={r.w + PAD * 2}
            height={r.h + PAD * 2}
            rx={RADIUS}
            ry={RADIUS}
          />
        ))}
      </svg>
    </div>,
    document.body,
  );
}
