import { useState } from "react";
import { savedToast, send, useApi } from "../api";
import { Card, Field, PageHeader } from "../components/ui";
import { localToday, prettyDate } from "../dates";
import type { Benchmark } from "../types";

const SUGGESTED = [
  { name: "Max hang 20mm 10s", unit: "kg added" },
  { name: "Max pull-ups", unit: "reps" },
  { name: "Weighted pull-up 1RM", unit: "kg added" },
  { name: "Hardest boulder", unit: "grade" },
  { name: "Hardest route", unit: "grade" },
  { name: "Bodyweight", unit: "kg" },
];

export default function Benchmarks() {
  const { data, error, reload } = useApi<Benchmark[]>("/benchmarks");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");

  async function submit() {
    savedToast(await send("POST", "/benchmarks", { date: localToday(), name: name.trim(), value: value.trim(), unit: unit.trim() || null }), "Benchmark saved");
    setValue("");
    reload();
  }

  async function remove(id: number) {
    if (!confirm("Delete this result?")) return;
    await send("DELETE", `/benchmarks/${id}`);
    reload();
  }

  const names = [...new Set((data ?? []).map((b) => b.name))];

  return (
    <div className="page">
      <PageHeader title="Benchmarks" sub="Test at the start, middle and end of the block." back="#/more" />
      <Card title="Add a result">
        <div className="form">
          <Field label="Test">
            <input list="bench-names" value={name} placeholder="e.g. Max hang 20mm 10s"
              onChange={(e) => {
                setName(e.target.value);
                const s = SUGGESTED.find((x) => x.name === e.target.value);
                if (s) setUnit(s.unit);
              }} />
            <datalist id="bench-names">{[...new Set([...names, ...SUGGESTED.map((s) => s.name)])].map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <div className="grid2">
            <Field label="Result"><input value={value} onChange={(e) => setValue(e.target.value)} /></Field>
            <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
          </div>
          <button className="btn primary block" disabled={!name.trim() || !value.trim()} onClick={submit}>Save</button>
        </div>
      </Card>
      {error && <p className="error">{error}</p>}
      {names.map((n) => (
        <Card key={n} title={n}>
          {data!.filter((b) => b.name === n).map((b) => (
            <div key={b.id} className="entry">
              <span><strong>{b.value}</strong> {b.unit} <span className="muted small">· {prettyDate(b.date)}</span></span>
              <button className="icon-btn" aria-label="Delete" onClick={() => remove(b.id)}>×</button>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
