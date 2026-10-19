// Gym field on the Log page (#48): a text box with a dropdown of gyms used before. Tapping the box lists them
// all, most recently used first, even when it already holds one; typing filters them (worker/gyms.ts
// filterGyms: names starting with the letters first). A new name is simply typed; the server reuses an
// existing spelling when it matches.
import { useId, useState } from "react";
import { type KnownGym, filterGyms, gymKey } from "../../worker/gyms";

export function GymPicker({ value, onChange, gyms }: { value: string; onChange: (v: string) => void; gyms: KnownGym[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [typing, setTyping] = useState(false); // tapping the box lists every gym; typing filters
  const listId = useId();
  const matches = typing ? filterGyms(value, gyms) : gyms;
  const current = gymKey(value);
  // Nothing to offer when the only match is what's already in the box.
  const showList = open && matches.length > 0 && !(matches.length === 1 && gymKey(matches[0].name) === current);

  function pick(name: string) {
    onChange(name);
    setOpen(false);
    setTyping(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && showList && active >= 0) {
      e.preventDefault();
      pick(matches[active].name);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="combo">
      <div className="combo-input">
        <input
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={value}
          placeholder={gyms.length ? "Pick or type a gym" : "Type the gym's name"}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          maxLength={60}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setTyping(true);
            setActive(-1);
          }}
          onFocus={() => {
            setOpen(true);
            setTyping(false);
          }}
          onBlur={() => setOpen(false)} // options use onMouseDown + preventDefault, so a tap picks before blur
          onKeyDown={onKeyDown}
        />
        {value && (
          <button type="button" className="combo-clear" aria-label="Clear gym" onMouseDown={(e) => e.preventDefault()} onClick={() => pick("")}>
            ×
          </button>
        )}
      </div>
      {showList && (
        <ul className="combo-list" id={listId} role="listbox" aria-label="Gyms used before">
          {matches.map((g, i) => (
            <li
              key={g.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active || gymKey(g.name) === current}
              className={[i === active && "active", gymKey(g.name) === current && "current"].filter(Boolean).join(" ") || undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(g.name)}
            >
              <span>{g.name}</span>
              <span className="muted small">
                {g.sessions} {g.sessions === 1 ? "session" : "sessions"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
