// Coach-written text (plan details, coach notes, review summaries) as a short bullet list instead of a paragraph.
import { textSteps } from "../planDetails";

export function StepList({ text, className = "steps" }: { text: string | null | undefined; className?: string }) {
  const steps = textSteps(text);
  if (steps.length === 0) return null;
  return (
    <ul className={className}>
      {steps.map((s, i) => (
        <li key={i}>
          {s.label && <strong>{s.label}: </strong>}
          {s.text}
        </li>
      ))}
    </ul>
  );
}
