// Weekly chart "by type" view (#32): each week's minutes stacked by type group, rope at the baseline so
// its trend is easiest to read. Tap a week for minutes (and load) per group.
import { useState } from "react";
import { prettyDate } from "../dates";
import { type MixSession, TYPE_GROUPS, formatMinutes, mixByWeek } from "../../worker/typeGroups";
import { GroupLegend, GroupSwatch } from "./typeGroups";

// Compact bar label: "45m", "6.2h".
const short = (min: number) => (min < 60 ? `${min}m` : `${Math.round(min / 6) / 10}h`);

export function TypeWeekChart({ weekStarts, sessions }: { weekStarts: string[]; sessions: MixSession[] }) {
  const weeks = mixByWeek(sessions, weekStarts);
  const [picked, setPicked] = useState(weeks.length - 1);
  const totals = weeks.map((w) => TYPE_GROUPS.reduce((acc, g) => acc + w[g.key].minutes, 0));
  const max = Math.max(1, ...totals);
  const w = weeks[picked];
  // Top of the stack first in the DOM (column flex), so rope ends up at the baseline.
  const stackOrder = [...TYPE_GROUPS].reverse();

  return (
    <div className="viz">
      <GroupLegend />
      <div className="bars" role="list">
        {weeks.map((wk, i) => (
          <button
            key={weekStarts[i]}
            role="listitem"
            className={i === picked ? "bar-col picked" : "bar-col"}
            aria-label={`Week of ${prettyDate(weekStarts[i])}: ${TYPE_GROUPS.map((g) => `${g.label} ${wk[g.key].minutes} min`).join(", ")}`}
            onClick={() => setPicked(i)}
          >
            <span className="bar-total">{totals[i] ? short(totals[i]) : ""}</span>
            <span className="bar-stack" style={{ height: `calc(${totals[i] / max} * (100% - 18px))` }}>
              {stackOrder.map(
                (g) => wk[g.key].minutes > 0 && <span key={g.key} className={`seg g g-${g.key}`} style={{ flexGrow: wk[g.key].minutes }} />,
              )}
            </span>
            <span className="bar-label">
              {weekStarts[i].slice(8)}/{weekStarts[i].slice(5, 7)}
            </span>
          </button>
        ))}
      </div>
      {w && (
        <div className="viz-detail">
          <p className="small">
            Week of {prettyDate(weekStarts[picked])}: <strong>{formatMinutes(totals[picked])}</strong>
          </p>
          <ul className="group-rows" aria-label="Minutes per type that week">
            {TYPE_GROUPS.map((g) => (
              <li key={g.key}>
                <span className="name">
                  <GroupSwatch group={g.key} /> {g.label}
                </span>
                <span className="nums">
                  {formatMinutes(w[g.key].minutes)}
                  <span className="muted"> · load {w[g.key].load}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
