// Training mix for a period (#32): time per type group first (endurance comes from time on the wall),
// load second, plus rope vs boulder share of climbing time.
import { type MixPeriod } from "../calendar";
import { gymsText } from "../../worker/gyms";
import { CLIMBING_GROUPS, type Mix, TYPE_GROUPS, climbingSummary, formatMinutes } from "../../worker/typeGroups";
import { Chips } from "./ui";
import { GroupSwatch } from "./typeGroups";

export function MixSummary({
  mix,
  gyms = [],
  period,
  onPeriod,
  monthName,
  loading,
}: {
  mix: Mix | null; // null while the month on screen is loading
  gyms?: { name: string; sessions: number }[]; // sessions per gym in the period (#48)
  period: MixPeriod;
  onPeriod: (p: MixPeriod) => void;
  monthName: string; // "This month" or the calendar month's name
  loading?: boolean;
}) {
  const summary = mix && climbingSummary(mix);

  return (
    <div className="viz">
      <div className="view-toggle">
        <Chips<MixPeriod>
          options={[
            { value: "4w", label: "4 weeks" },
            { value: "8w", label: "8 weeks" },
            { value: "month", label: monthName },
          ]}
          value={period}
          onChange={(v) => v && onPeriod(v)}
        />
      </div>
      {!mix ? (
        <p className="muted small">{loading ? "Loading…" : "Nothing to show."}</p>
      ) : (
        <>
          {summary === null ? (
            <p className="small muted">No rope or boulder climbing in this period.</p>
          ) : (
            <>
              <p className="small">{summary}</p>
              <div className="share-bar" aria-hidden="true">
                {CLIMBING_GROUPS.map(
                  (k) => mix[k].minutes > 0 && <span key={k} className={`seg g g-${k}`} style={{ flexGrow: mix[k].minutes }} />,
                )}
              </div>
            </>
          )}
          <ul className="group-rows" aria-label="Time and load per type">
            {TYPE_GROUPS.map((g) => (
              <li key={g.key}>
                <span className="name">
                  <GroupSwatch group={g.key} /> {g.label}
                  <span className="muted small">
                    {mix[g.key].sessions} {mix[g.key].sessions === 1 ? "session" : "sessions"}
                  </span>
                </span>
                <span className="nums">
                  <strong>{formatMinutes(mix[g.key].minutes)}</strong>
                  {mix[g.key].outdoor_minutes > 0 && <span> ({formatMinutes(mix[g.key].outdoor_minutes)} outdoor)</span>}
                  <span className="muted"> · load {mix[g.key].load}</span>
                </span>
              </li>
            ))}
          </ul>
          {gyms.length > 0 && (
            <p className="small">
              <span className="muted">Gyms: </span>
              {gymsText(gyms)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
