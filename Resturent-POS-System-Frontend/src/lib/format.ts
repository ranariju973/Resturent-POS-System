const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The single place the currency symbol is defined. Change it here, not inline. */
export const CURRENCY = '₹';

/**
 * Indian grouping, not Western: 1,23,456.78 rather than 123,456.78. The last
 * three digits group together, everything above them in pairs — `en-IN` knows
 * this, a manual `toFixed` does not.
 *
 * Always two decimals, so a total never renders as a bare rupee amount next to
 * one carrying paise.
 */
const inr = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const money = (n: number) => `${CURRENCY}${inr.format(n)}`;

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
