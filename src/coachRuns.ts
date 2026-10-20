// Labels for Settings' coach activity (#64). Pure, so they can be tested without a browser.
import { dayLabel, localDateOf, localToday } from "./dates";

// "Today 07:45", "Yesterday 21:02", "Mon 12 Oct 08:00", in the phone's timezone.
export function stampLabel(stamp: string, today = localToday()): string {
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return stamp;
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${dayLabel(localDateOf(stamp), today)} ${time}`;
}

// The next run is an estimate (one interval after the last), so it is labelled as expected, and as overdue
// once that time has passed without a new run.
export function nextRunLabel(expected: string | null, now = new Date(), today = localToday()): string {
  if (!expected) return "After the first run";
  const t = Date.parse(expected);
  if (Number.isNaN(t)) return "Unknown";
  return t <= now.getTime() ? `Overdue (expected ${stampLabel(expected, today)})` : `Expected around ${stampLabel(expected, today)}`;
}
