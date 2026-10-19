// Shared pieces for showing session type groups (worker/typeGroups.ts): the coloured marker with its
// letter, a swatch and the legend. Colour always comes with a letter or a label.
import { type GroupKey, TYPE_GROUPS, groupInfo } from "../../worker/typeGroups";

// outdoor (#33) adds an outline ring: a shape cue, not a colour, explained in the legend.
export function GroupMarker({ group, title, outdoor }: { group: GroupKey; title?: string; outdoor?: boolean }) {
  const label = title ?? groupInfo(group).label;
  return (
    <span className={`marker g-${group}${outdoor ? " outdoor" : ""}`} title={outdoor ? `${label}, outdoor` : label} aria-hidden="true">
      {groupInfo(group).letter}
    </span>
  );
}

export const GroupSwatch = ({ group }: { group: GroupKey }) => <i className={`swatch g g-${group}`} />;

export function GroupLegend({ markers = false }: { markers?: boolean }) {
  return (
    <div className="legend wrap">
      {TYPE_GROUPS.map((g) => (
        <span key={g.key}>
          {markers ? <GroupMarker group={g.key} /> : <GroupSwatch group={g.key} />} {g.label}
        </span>
      ))}
      {markers && (
        <span>
          <span className="marker outdoor outdoor-key" aria-hidden="true" /> Outdoor
        </span>
      )}
    </div>
  );
}
