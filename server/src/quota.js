/**
 * Google's free quotas count per day in Pacific time and come back at midnight there.
 * The server uses that day for its own budget, and as the guess for "when does it come
 * back" when Google does not say.
 */

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

export const pacificDay = (ms) => fmt.format(new Date(ms));

/** The first minute of the next Pacific day, in ms. */
export function nextPacificMidnight(ms) {
  const day = pacificDay(ms);
  let t = ms;
  while (pacificDay(t) === day) t += 30 * 60_000;
  while (pacificDay(t - 60_000) !== day) t -= 60_000;
  return t;
}
