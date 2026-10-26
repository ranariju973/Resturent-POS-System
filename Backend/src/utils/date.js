/** India calendar days and 04:00 service days, independent of the host TZ. */
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';
export const DAY_MS = 86_400_000;
const INDIA_OFFSET_MS = 330 * 60_000;
const RESET_MS = 4 * 3_600_000;

export const todayIso = (now = new Date()) =>
  new Date(new Date(now).getTime() + INDIA_OFFSET_MS).toISOString().slice(0, 10);
export const dayStart = (iso) => new Date(`${iso}T00:00:00+05:30`);
export const dayEnd = (iso) => new Date(dayStart(iso).getTime() + DAY_MS);

export function monthStart(month, offset = 0) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1) - INDIA_OFFSET_MS);
}

export function serviceWindow(now = new Date()) {
  const time = new Date(now).getTime();
  const start = Math.floor((time + INDIA_OFFSET_MS - RESET_MS) / DAY_MS) * DAY_MS
    - INDIA_OFFSET_MS + RESET_MS;
  return {
    serviceStart: new Date(start),
    recentSince: new Date(start - DAY_MS),
    nextResetAt: new Date(start + DAY_MS),
  };
}

export const nextServiceReset = (placedAt = new Date()) => serviceWindow(placedAt).nextResetAt;
export default { todayIso, dayStart, dayEnd, monthStart, serviceWindow, nextServiceReset };
