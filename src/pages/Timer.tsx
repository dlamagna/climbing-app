import { useEffect, useMemo, useRef, useState } from "react";
import { isQueued, savedToast, send, toast, useApi } from "../api";
import { Card, Chips, Field, PageHeader, Stepper, range, seconds } from "../components/ui";
import { localToday } from "../dates";
import { Beeper, PHASE_LABEL, ScreenLock, buildPhases, clock, totalSeconds } from "../timer";
import type { Preset } from "../types";
import { effortHint } from "./Log";

const LAST_PRESET_KEY = "climb.lastPreset";
const GRIPS = ["open hand", "half crimp", "full crimp", "3 finger drag", "pinch"];

const blankPreset: Preset = {
  name: "Custom",
  prep_s: 10,
  on_s: 10,
  off_s: 20,
  reps: 6,
  sets: 1,
  set_rest_s: 0,
  edge_mm: 20,
  grip: "half crimp",
  added_kg: 0,
  notes: null,
};

interface Result {
  preset: Preset;
  completed: number;
  planned: number;
  elapsedSec: number;
  stoppedEarly: boolean;
}

function lastPresetName(): string | null {
  try {
    return localStorage.getItem(LAST_PRESET_KEY);
  } catch {
    return null;
  }
}

export default function Timer() {
  const { data: presets, error, reload } = useApi<Preset[]>("/presets");
  const [selected, setSelected] = useState<Preset | null>(null);
  const [draft, setDraft] = useState<Preset>(blankPreset);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Pick the last used preset (or the first one) once presets load.
  useEffect(() => {
    if (!presets?.length || selected) return;
    const p = presets.find((x) => x.name === lastPresetName()) ?? presets[0];
    choose(p);
  }, [presets]);

  function choose(p: Preset) {
    setSelected(p);
    setDraft({ ...p });
    try {
      localStorage.setItem(LAST_PRESET_KEY, p.name);
    } catch {
      // ignore
    }
  }

  const set = <K extends keyof Preset>(k: K, v: Preset[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = selected !== null && JSON.stringify(selected) !== JSON.stringify(draft);

  async function savePreset(asNew: boolean) {
    if (asNew) {
      const name = prompt("Name for the new preset", `${draft.name} (copy)`);
      if (!name) return;
      const p = { ...draft, id: undefined, name, sort: (presets?.length ?? 0) + 1 };
      const r = await send<{ id: number }>("POST", "/presets", p);
      if (isQueued(r)) return toast("Offline - try again with signal");
      await reload();
      choose({ ...p, id: r.id });
    } else if (draft.id) {
      savedToast(await send("PUT", `/presets/${draft.id}`, draft), "Preset updated");
      await reload();
      setSelected({ ...draft });
    }
  }

  async function deletePreset() {
    if (!draft.id || !confirm(`Delete preset "${draft.name}"?`)) return;
    await send("DELETE", `/presets/${draft.id}`);
    setSelected(null);
    await reload();
  }

  if (running) {
    return (
      <Runner
        preset={draft}
        onFinish={(r) => {
          setRunning(false);
          setResult(r);
        }}
      />
    );
  }

  if (result) return <Finished result={result} onClose={() => setResult(null)} />;

  return (
    <div className="page">
      <PageHeader title="Hangboard timer" />
      {error && !presets && <p className="error">{error}</p>}

      <Chips
        wrap
        options={[
          ...(presets ?? []).map((p) => ({ value: p.name, label: p.name })),
          { value: "__custom", label: "+ Custom" },
        ]}
        value={selected ? selected.name : "__custom"}
        onChange={(name) => {
          const p = presets?.find((x) => x.name === name);
          if (p) choose(p);
          else {
            setSelected(null);
            setDraft({ ...blankPreset });
          }
        }}
      />

      <Card>
        <p className="summary">
          {draft.sets > 1 && `${draft.sets} sets × `}
          {draft.reps} × {draft.on_s}s on / {seconds(draft.off_s)} off
          {draft.sets > 1 && draft.set_rest_s > 0 && ` · ${seconds(draft.set_rest_s)} between sets`}
        </p>
        <p className="muted small">
          {[draft.edge_mm && `${draft.edge_mm}mm`, draft.grip, draft.added_kg ? `${draft.added_kg > 0 ? "+" : ""}${draft.added_kg}kg` : null]
            .filter(Boolean)
            .join(" · ")}
          {" · "}total {seconds(totalSeconds(draft))}
        </p>
        {draft.notes && <p className="muted small prewrap">{draft.notes}</p>}
        <button className="btn primary block big" disabled={draft.reps < 1 || draft.sets < 1 || draft.on_s < 1} onClick={() => setRunning(true)}>
          Start
        </button>
      </Card>

      <Card title="Adjust">
        <div className="grid2">
          <Field label="Hang">
            <Stepper value={draft.on_s} min={1} max={120} format={(v) => `${v}s`} onChange={(v) => set("on_s", v)} />
          </Field>
          <Field label="Rest">
            <Stepper value={draft.off_s} min={0} max={600} step={draft.off_s >= 60 ? 15 : 1} format={seconds} onChange={(v) => set("off_s", v)} />
          </Field>
          <Field label="Reps">
            <Stepper value={draft.reps} min={1} max={50} onChange={(v) => set("reps", v)} />
          </Field>
          <Field label="Sets">
            <Stepper value={draft.sets} min={1} max={20} onChange={(v) => set("sets", v)} />
          </Field>
          <Field label="Set rest">
            <Stepper value={draft.set_rest_s} min={0} max={900} step={15} format={seconds} onChange={(v) => set("set_rest_s", v)} />
          </Field>
          <Field label="Get ready">
            <Stepper value={draft.prep_s} min={0} max={60} step={5} format={(v) => `${v}s`} onChange={(v) => set("prep_s", v)} />
          </Field>
          <Field label="Edge">
            <Stepper value={draft.edge_mm ?? 20} min={5} max={60} format={(v) => `${v}mm`} onChange={(v) => set("edge_mm", v)} />
          </Field>
          <Field label="Added weight">
            <Stepper value={draft.added_kg ?? 0} min={-40} max={80} step={1} format={(v) => `${v > 0 ? "+" : ""}${v}kg`} onChange={(v) => set("added_kg", v)} />
          </Field>
        </div>
        <Field label="Grip">
          <Chips wrap clearable options={GRIPS.map((g) => ({ value: g, label: g }))} value={draft.grip} onChange={(v) => set("grip", v)} />
        </Field>
        <div className="actions">
          {selected?.id && (
            <button className="btn" disabled={!dirty} onClick={() => savePreset(false)}>
              Update “{selected.name}”
            </button>
          )}
          <button className="btn" onClick={() => savePreset(true)}>
            Save as new
          </button>
          {selected?.id && (
            <button className="btn danger" onClick={deletePreset}>
              Delete
            </button>
          )}
        </div>
      </Card>
      <p className="muted small">Beeps 3-2-1 before each change. Keep the volume up; the screen stays on while it runs.</p>
    </div>
  );
}

function Runner({ preset, onFinish }: { preset: Preset; onFinish: (r: Result) => void }) {
  const phases = useMemo(() => buildPhases(preset), [preset]);
  const total = useMemo(() => phases.reduce((a, p) => a + p.duration, 0), [phases]);
  const planned = preset.reps * preset.sets;

  const beeper = useRef(new Beeper());
  const screen = useRef(new ScreenLock());
  const idx = useRef(0);
  const endsAt = useRef(0);
  const pausedLeft = useRef<number | null>(null);
  const completed = useRef(0);
  const startedAt = useRef(0);
  const lastBeep = useRef("");
  const finished = useRef(false);
  const [view, setView] = useState({ i: 0, left: phases[0]?.duration ?? 0, paused: false });

  function finish(stoppedEarly: boolean) {
    if (finished.current) return;
    finished.current = true;
    screen.current.stop();
    if (!stoppedEarly) beeper.current.done();
    onFinish({
      preset,
      completed: completed.current,
      planned,
      elapsedSec: Math.round((performance.now() - startedAt.current) / 1000),
      stoppedEarly,
    });
  }

  function startPhase(i: number) {
    const k = phases[i].kind;
    if (k === "hang") beeper.current.hang();
    else if (k !== "prep") beeper.current.rest();
    if (navigator.vibrate) navigator.vibrate(k === "hang" ? 300 : 120);
  }

  // Advance past the current phase. A hang only counts when it ran to the end, not when skipped.
  function advance(countHang: boolean): boolean {
    if (phases[idx.current].kind === "hang" && countHang) completed.current++;
    idx.current++;
    if (idx.current >= phases.length) {
      finish(false);
      return false;
    }
    endsAt.current += phases[idx.current].duration * 1000;
    startPhase(idx.current);
    return true;
  }

  function tick() {
    if (finished.current || pausedLeft.current !== null) return;
    const now = performance.now();
    // Loop: if the page was throttled, catch up through every phase that ended meanwhile.
    while (now >= endsAt.current) if (!advance(true)) return;
    const left = Math.ceil((endsAt.current - now) / 1000);
    const key = `${idx.current}:${left}`;
    if (left <= 3 && lastBeep.current !== key && phases[idx.current].duration > 3) {
      lastBeep.current = key;
      beeper.current.countdown();
    }
    setView({ i: idx.current, left, paused: false });
  }

  useEffect(() => {
    beeper.current.unlock();
    void screen.current.start();
    startedAt.current = performance.now();
    endsAt.current = startedAt.current + phases[0].duration * 1000;
    startPhase(0);
    const id = setInterval(tick, 100);
    return () => {
      clearInterval(id);
      screen.current.stop();
    };
  }, []);

  function togglePause() {
    const now = performance.now();
    if (pausedLeft.current === null) {
      pausedLeft.current = endsAt.current - now;
      setView((v) => ({ ...v, paused: true }));
    } else {
      endsAt.current = now + pausedLeft.current;
      pausedLeft.current = null;
      tick();
    }
  }

  function skip() {
    const now = performance.now();
    const left = pausedLeft.current ?? endsAt.current - now;
    endsAt.current -= left; // jump to the end of this phase, then into the next one
    if (pausedLeft.current !== null) pausedLeft.current = phases[idx.current + 1]?.duration * 1000;
    if (advance(false)) {
      if (pausedLeft.current !== null) endsAt.current = now + pausedLeft.current;
      tick();
      setView((v) => ({ ...v, i: idx.current, left: phases[idx.current].duration }));
    }
  }

  const phase = phases[view.i];
  const next = phases[view.i + 1];
  const elapsedPlanned = phases.slice(0, view.i).reduce((a, p) => a + p.duration, 0) + (phase.duration - view.left);

  return (
    <div className={`runner ${phase.kind}${view.paused ? " paused" : ""}`}>
      <div className="runner-top">
        <span>{preset.name}</span>
        <span>
          Rep {phase.rep}/{preset.reps}
          {preset.sets > 1 && ` · Set ${phase.set}/${preset.sets}`}
        </span>
      </div>
      <div className="runner-main">
        <div className="runner-phase">{view.paused ? "Paused" : PHASE_LABEL[phase.kind]}</div>
        <div className="runner-count">{clock(view.left)}</div>
        <div className="runner-next">{next ? `Next: ${PHASE_LABEL[next.kind]} ${seconds(next.duration)}` : "Last one!"}</div>
      </div>
      <div className="runner-progress">
        <div style={{ width: `${Math.min(100, (elapsedPlanned / total) * 100)}%` }} />
      </div>
      <div className="runner-controls">
        <button
          onClick={() => {
            if (confirm("Stop the timer?")) finish(true);
          }}
        >
          Stop
        </button>
        <button className="main" onClick={togglePause}>
          {view.paused ? "Resume" : "Pause"}
        </button>
        <button onClick={skip}>Skip</button>
      </div>
    </div>
  );
}

function Finished({ result, onClose }: { result: Result; onClose: () => void }) {
  const { preset, completed, planned, elapsedSec, stoppedEarly } = result;
  const [saved, setSaved] = useState<"saving" | "saved" | "queued" | "skipped" | "error">(completed > 0 ? "saving" : "skipped");
  const [rpe, setRpe] = useState<number | null>(null);
  const [sessionLogged, setSessionLogged] = useState(false);
  const posted = useRef(false);

  // The hangboard log is saved automatically; logging it as a session (for training load) is optional.
  useEffect(() => {
    if (completed === 0 || posted.current) return;
    posted.current = true;
    send("POST", "/hangs", {
      date: localToday(),
      preset: preset.name,
      on_s: preset.on_s,
      off_s: preset.off_s,
      reps: preset.reps,
      sets: preset.sets,
      set_rest_s: preset.set_rest_s,
      completed_reps: completed,
      edge_mm: preset.edge_mm,
      grip: preset.grip,
      added_kg: preset.added_kg,
    })
      .then((r) => setSaved(isQueued(r) ? "queued" : "saved"))
      .catch(() => setSaved("error"));
  }, []);

  async function logSession() {
    const r = await send("POST", "/sessions", {
      date: localToday(),
      type: "hangboard",
      duration_min: Math.max(1, Math.round(elapsedSec / 60)),
      rpe,
      notes: `${preset.name}: ${completed}/${planned} hangs`,
    });
    savedToast(r, "Session logged");
    setSessionLogged(true);
  }

  return (
    <div className="page">
      <PageHeader title={stoppedEarly ? "Stopped" : "Done"} sub={`${preset.name} · ${completed}/${planned} hangs · ${seconds(elapsedSec)}`} />
      <p className="muted">
        {{
          saving: "Saving…",
          saved: "Saved to your log ✓",
          queued: "Saved offline - will sync when you have signal",
          skipped: "Nothing to save - no hangs completed.",
          error: "Couldn't save this one.",
        }[saved]}
      </p>
      {completed > 0 && !sessionLogged && (
        <Card title="Also log as a hangboard session?">
          <p className="muted small">Only if this was its own workout, not a warm-up before climbing - otherwise you'd count it twice.</p>
          <Field label="How hard" hint={effortHint(rpe)}>
            <Chips wrap options={range(1, 10).map((v) => ({ value: v, label: String(v) }))} value={rpe} onChange={setRpe} />
          </Field>
          <button className="btn block" disabled={rpe === null} onClick={logSession}>
            Log session
          </button>
        </Card>
      )}
      <button className="btn primary block" onClick={onClose}>
        Back to timer
      </button>
    </div>
  );
}
