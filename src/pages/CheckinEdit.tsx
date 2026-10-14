import { useApi } from "../api";
import { PageHeader } from "../components/ui";
import type { Checkin } from "../types";
import { CheckinForm } from "./Today";

// #/checkin?date=<YYYY-MM-DD> edits a past morning check-in (from History) with the same form as Today.
export default function CheckinEdit() {
  const date = new URLSearchParams(location.hash.split("?")[1]).get("date");
  const { data, error } = useApi<Checkin>(date ? `/checkins/${date}` : null);

  return (
    <div className="page">
      <PageHeader title="Edit check-in" back="#/history" />
      {!date ? (
        <p className="error">No check-in picked.</p>
      ) : data ? (
        <CheckinForm date={date} initial={data} defaults={null} editDate onSaved={() => (location.hash = "#/history")} />
      ) : error ? (
        <p className="error">{error}</p>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
