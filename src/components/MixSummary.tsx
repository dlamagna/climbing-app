// Training mix for a period (#32): time per type group first (endurance comes from time on the wall),
// load second, plus rope vs boulder share of climbing time.
import { type MixPeriod } from "../calendar";
import { CLIMBING_GROUPS, type Mix, TYPE_GROUPS, climbingShares, formatMinutes, groupInfo } from "../../worker/typeGroups";
import { Chips } from "./ui";
import { GroupSwatch } from "./typeGroups";

export function MixSummary({
  mix,
  period,
  onPeriod,
  monthName,
  loading,
}: {
  mix: Mix | null; // null while the month on screen is loading
  period: MixPeriod;
  onPeriod: (p: MixPeriod) => void;
  monthName: string; // "This month" or the calendar month's name
  loading?: boolean;
}) {
  const shares = mix && climbingShares(mix);

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
          {shares!.rope === null ? (
            <p className="small muted">No rope or boulder climbing in this period.</p>
          ) : (
            <>
              <p className="small">
                {CLIMBING_GROUPS
                  .map((k) => `${groupInfo(k).label} ${formatMinutes(mix[k].minutes)} (${shares![k]}%)`)
                  .join(" · ")}
              </p>
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
                  <span className="muted"> · load {mix[g.key].load}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
