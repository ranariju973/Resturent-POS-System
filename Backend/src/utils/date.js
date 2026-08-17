/**
 * Service-day boundaries.
 *
 * Lived inside reportController until the stats cache needed to know whether a
 * requested date is today — a report for a finished day can be held far longer
 * than one still being written to. Copying the function into the cache would
 * have meant two definitions of "what day is it", which is exactly the kind of
 * thing that agrees in testing and disagrees at midnight.
 *
 * All of these use SERVER LOCAL TIME, deliberately and consistently with
 * Counter.serviceDayKey(). A restaurant's day is the one its staff are
 * standing in, not UTC. The consequence is that the host's timezone is part of
 * the configuration: deploy to a UTC host and the day boundary moves, which
 * splits an evening service across two report dates.
 */

/** Today as YYYY-MM-DD, in server local time. */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Midnight opening a given YYYY-MM-DD. */
export const dayStart = (iso) => new Date(`${iso}T00:00:00`);

/** Midnight closing it — exclusive upper bound, so ranges are [start, end). */
export const dayEnd = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
};

export default { todayIso, dayStart, dayEnd };
