const DAY = 86_400_000;
const OFFSET = 330 * 60_000 - 4 * 3_600_000;
export function operationalWindow(now = Date.now()) {
  const start = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  return { recentSince: start - DAY, nextResetAt: start + DAY };
}

export const indiaToday = (now = Date.now()) =>
  new Date(now + 330 * 60_000).toISOString().slice(0, 10);
