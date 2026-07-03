/** Small display formatters (locale-aware where it matters). */

export const fmtDateTime = (iso: string, locale: string): string => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'zh-Hant', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

export const fmtBytes = (n: number): string => {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
};

export const fmtUptime = (seconds: number): string => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…` : id);
