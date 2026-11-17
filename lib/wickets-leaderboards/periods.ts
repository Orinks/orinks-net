// Challenge periods, keyed exactly as Wicket's keys them: "2026-11-06",
// "2026-W45", "2026-11", all in UTC, so a board turns over at the same moment
// the game's challenge does. Copied from the leaderboard service
// (lib/wickets-online/periods.js on the lb branch).

export const PERIODS = ["daily", "weekly", "monthly"] as const;
export type Period = (typeof PERIODS)[number];

const DAY = 86_400_000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** The ISO 8601 week-numbering year and week of a UTC time. */
export function isoWeek(ms: number) {
  const d = new Date(Math.floor(ms / DAY) * DAY);
  const weekday = (d.getUTCDay() + 6) % 7; // Monday 0
  const thursday = new Date(d.getTime() + (3 - weekday) * DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = 1 + Math.floor((thursday.getTime() - jan1) / DAY / 7);
  return { year, week };
}

/** The key of the period that `ms` falls in. */
export function periodKey(period: Period, ms: number) {
  const d = new Date(ms);
  switch (period) {
    case "daily":
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    case "weekly": {
      const { year, week } = isoWeek(ms);
      return `${year}-W${pad(week)}`;
    }
    case "monthly":
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
}

/** When the period that `ms` falls in began, in ms. */
export function periodStart(period: Period, ms: number) {
  const day = Math.floor(ms / DAY) * DAY;
  const d = new Date(day);
  switch (period) {
    case "daily":
      return day;
    case "weekly":
      return day - ((d.getUTCDay() + 6) % 7) * DAY;
    case "monthly":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
}

/** When the period that `ms` falls in ends, in ms. */
export function periodEnd(period: Period, ms: number) {
  const start = periodStart(period, ms);
  switch (period) {
    case "daily":
      return start + DAY;
    case "weekly":
      return start + 7 * DAY;
    case "monthly": {
      const d = new Date(start);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  }
}
