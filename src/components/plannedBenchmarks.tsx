// Inputs for the tests the plan expects on a session's date (issue #22). Kept separate from the Log page
// so other "log the planned session" paths can reuse it.

import { useState } from "react";
import { useApi } from "../api";
import { type BenchmarkInput, benchmarkInputs, benchmarkKey } from "../benchmarkInputs";
import type { PlanEntry, SessionBenchmark } from "../types";
import { Field } from "./ui";

// Re-reads the plan when the date changes; typed values are kept by test name across date changes.
export function useBenchmarkInputs(date: string, saved: SessionBenchmark[] = []) {
  const { data: plan } = useApi<PlanEntry[]>(`/plan?from=${date}&to=${date}`);
  const [values, setValues] = useState<Record<string, string>>({});
  const inputs = benchmarkInputs(plan ?? [], date, saved, values);
  const setValue = (name: string, value: string) => setValues((v) => ({ ...v, [benchmarkKey(name)]: value }));
  return { inputs, setValue };
}

const NUMERIC_UNITS = /^(reps?|kg|kg added|lbs?|s|sec|secs|seconds|cm|mm|m|km)$/i;

export function BenchmarkFields({ inputs, onChange }: { inputs: BenchmarkInput[]; onChange: (name: string, value: string) => void }) {
  if (!inputs.length) return null;
  return (
    <Field label="Planned tests" hint="leave empty if not done">
      <div className="bench-inputs">
        {inputs.map((b) => (
          <label key={benchmarkKey(b.name)} className="bench-row">
            <span>
              {b.name}
              {b.unit && <span className="muted small"> · {b.unit}</span>}
            </span>
            <input
              value={b.value}
              inputMode={b.unit && NUMERIC_UNITS.test(b.unit) ? "decimal" : "text"}
              onChange={(e) => onChange(b.name, e.target.value)}
            />
          </label>
        ))}
      </div>
    </Field>
  );
}
