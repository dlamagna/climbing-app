// History's calendar and mix cards (#32). The page's own fetch covers the last 8 weeks; a calendar month
// that starts earlier is fetched on its own (sessions only).
import { useState } from "react";
import { useApi } from "../api";
import { type MixPeriod, monthEnd, monthOf, monthStart, periodRange } from "../calendar";
import type { Session } from "../types";
import { groupMix, inRange } from "../../worker/typeGroups";
import { MixSummary } from "./MixSummary";
import { SessionCalendar } from "./SessionCalendar";
import { Card } from "./ui";

export function TrainingMix({ sessions, from, today }: { sessions: Session[]; from: string; today: string }) {
  const [month, setMonth] = useState(monthOf(today));
  const [period, setPeriod] = useState<MixPeriod>("4w");

  const older = monthStart(month) < from;
  const monthApi = useApi<{ sessions: Session[] }>(older ? `/history?from=${monthStart(month)}&to=${monthEnd(month)}&only=sessions` : null);
  // While an older month loads, show it empty rather than the previous month's markers.
  const monthSessions = older ? (monthApi.loading ? null : (monthApi.data?.sessions ?? null)) : sessions;

  const range = periodRange(period, today, month);
  const pool = period === "month" ? monthSessions : sessions;
  const mix = pool && groupMix(inRange(pool, range.from, range.to));
  const monthName =
    month === monthOf(today)
      ? "This month"
      : new Date(`${monthStart(month)}T00:00:00Z`).toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });

  return (
    <>
      <Card title="Calendar">
        <SessionCalendar month={month} onMonth={setMonth} sessions={monthSessions ?? []} today={today} loading={older && monthApi.loading} />
        {older && monthApi.error && <p className="error small">{monthApi.error}</p>}
      </Card>
      <Card title="Training mix">
        <MixSummary mix={mix} period={period} onPeriod={setPeriod} monthName={monthName} loading={older && monthApi.loading} />
      </Card>
    </>
  );
}
