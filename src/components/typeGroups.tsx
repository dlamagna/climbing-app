// Shared pieces for showing session type groups (worker/typeGroups.ts): the coloured marker with its
// letter, a swatch and the legend. Colour always comes with a letter or a label.
import { type GroupKey, TYPE_GROUPS, groupInfo } from "../../worker/typeGroups";

export function GroupMarker({ group, title }: { group: GroupKey; title?: string }) {
  // #33: an outdoor session can add a ring here (e.g. an extra class) without changing the layout.
  return (
    <span className={`marker g-${group}`} title={title ?? groupInfo(group).label} aria-hidden="true">
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
    </div>
  );
}
