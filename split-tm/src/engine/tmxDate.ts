export function parseTmxDate(v: string | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return dt.getUTCMonth() === mo - 1 ? dt : null;
}
