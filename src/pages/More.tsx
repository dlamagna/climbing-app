import { PageHeader } from "../components/ui";

const LINKS = [
  { href: "#/plan", title: "Plan", sub: "Upcoming sessions (Claude can write these)" },
  { href: "#/injuries", title: "Injuries", sub: "Report one - adds a daily pain check until it's healed" },
  { href: "#/benchmarks", title: "Benchmarks", sub: "Test results and bodyweight over time" },
  { href: "#/grades", title: "Grade table", sub: "Font and V for boulders, French and YDS for routes" },
  { href: "#/settings", title: "Profile & settings", sub: "Goal, trip, availability, connecting Claude" },
  { href: "#/feedback", title: "App feedback", sub: "Bugs and ideas - the coach turns them into GitHub issues" },
];

export default function More() {
  return (
    <div className="page">
      <PageHeader title="More" />
      <nav className="menu">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href}>
            <strong>{l.title}</strong>
            <span className="muted small">{l.sub}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
