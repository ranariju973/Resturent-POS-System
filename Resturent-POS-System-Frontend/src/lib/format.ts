const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const money = (n: number) => `$${n.toFixed(2)}`;

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
};

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Minutes as "12m" up to an hour, then "1h 5m". */
export const duration = (mins: number) =>
  mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

export const clockTime = (ms: number) => {
  const d = new Date(ms);
  const ap = d.getHours() >= 12 ? 'PM' : 'AM';
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
};

export const minutesSince = (from: number | null) =>
  from ? Math.max(0, Math.round((Date.now() - from) / 60000)) : 0;
