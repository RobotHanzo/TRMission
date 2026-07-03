/**
 * Hand-rolled SVG sparkline (no charting dependency — the repo draws its own
 * graphics). Data accumulates client-side from the overview poll; there is no
 * server-side time series, so this is honestly labelled "trend this visit".
 */
export function Sparkline({ values, width = 240 }: { values: number[]; width?: number }) {
  const h = 48;
  const pad = 4;
  if (values.length < 2) {
    return <svg className="oc-spark" viewBox={`0 0 ${width} ${h}`} aria-hidden />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="oc-spark" viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke="var(--oc-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
