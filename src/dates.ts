// Local calendar dates as 'YYYY-MM-DD' (the phone's timezone, not UTC).

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const localToday = () => fmt(new Date());

// The local calendar date of a UTC timestamp such as a row's created_at.
export const localDateOf = (stamp: string) => fmt(new Date(stamp));

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return fmt(d);
}

// "Wed 21", for day chips.
export const shortDay = (date: string) => parse(date).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

export const prettyDate = (date: string) =>
  parse(date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function dayLabel(date: string, today = localToday()): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  if (date === addDays(today, 1)) return "Tomorrow";
  return prettyDate(date);
}

// #/log?date=YYYY-MM-DD (from a History calendar day) starts a new session on that past or current day.
export function presetLogDate(param: string | null, today: string) {
  return param && /^\d{4}-\d{2}-\d{2}$/.test(param) && param <= today ? param : null;
}
