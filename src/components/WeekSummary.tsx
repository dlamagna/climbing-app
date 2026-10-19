// Weekly summary card on Today (#9): this week from Monday to today in a few lines. Numbers and wording come
// from worker/weekSummary.ts, the same summary the coach gets as get_overview's week_summary.
import {
  type WeekSummaryView,
  drinksText,
  fingerText,
  gymsRowText,
  isEmptyWeek,
  mixText,
  sessionsText,
  sleepText,
} from "../../worker/weekSummary";
import { Card } from "./ui";

export function WeekSummary({ week }: { week?: WeekSummaryView }) {
  if (!week) return null; // older cached response
  const rows: [string, string | null, string][] = [
    ["Sleep", sleepText(week.sleep), "no check-ins yet"],
    ["Drinks", drinksText(week.drinks), "none logged"],
    ["Sessions", sessionsText(week.sessions), ""],
    ["Fingers", fingerText(week.finger), ""],
    ["Climbing", mixText(week.mix), "no rope or boulder yet"],
    ["Gyms", week.gyms ? gymsRowText(week.gyms) : null, "none given yet"],
  ];
  return (
    <Card title="This week">
      {isEmptyWeek(week) ? (
        <p className="muted small">Nothing logged or planned since Monday yet.</p>
      ) : (
        <dl className="week-rows">
          {rows.map(([label, value, empty]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={value === null ? "muted" : undefined}>{value ?? empty}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
