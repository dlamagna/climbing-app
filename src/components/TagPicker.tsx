import { SESSION_TAGS, TAG_TYPES, type SessionTag, parseTags } from "../../worker/tags";
import { Field, MultiChips } from "./ui";

const label = (t: string) => t.replace("-", " ");

export const takesTags = (type: string | null) => type !== null && TAG_TYPES.includes(type);

// Optional style tags for climbing sessions (#25); one tap each, none required.
export function TagPicker({ value, onChange }: { value: SessionTag[]; onChange: (v: SessionTag[]) => void }) {
  return (
    <Field label="Style" hint="optional">
      <MultiChips options={SESSION_TAGS.map((t) => ({ value: t, label: label(t) }))} value={value} onChange={onChange} />
    </Field>
  );
}

// Compact display for History, e.g. "crimpy · overhang".
export function TagList({ tags }: { tags: string | null | undefined }) {
  const list = parseTags(tags);
  return list.length ? <span className="muted small"> · {list.map(label).join(" · ")}</span> : null;
}
