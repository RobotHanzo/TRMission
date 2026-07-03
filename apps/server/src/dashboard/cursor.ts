/**
 * Opaque (timestamp, id) pagination cursor for dashboard list endpoints. The composite
 * keeps pages stable when many documents share one timestamp. Malformed input decodes
 * to null (first page) rather than erroring — cursors are a convenience, not state.
 */
export interface TimeCursor {
  t: Date;
  id: string;
}

export const encodeCursor = (t: Date, id: string): string =>
  Buffer.from(JSON.stringify({ t: t.getTime(), id }), 'utf8').toString('base64url');

export const decodeCursor = (raw: string | undefined): TimeCursor | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { t?: unknown }).t !== 'number' ||
      typeof (parsed as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    const { t, id } = parsed as { t: number; id: string };
    return { t: new Date(t), id };
  } catch {
    return null;
  }
};
