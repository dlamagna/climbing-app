import { PageHeader } from "../components/ui";
import { coachInMore } from "../prefs";
import { hardRefreshBrowser } from "../hardRefresh";

const COACH_LINK = { href: "#/coach", title: "Coach", sub: "Notes, questions and reviews from Claude" };

const LINKS = [
  { href: "#/plan", title: "Plan", sub: "Upcoming sessions (Claude can write these)" },
  { href: "#/injuries", title: "Injuries", sub: "Report one - adds a daily pain check until it's healed" },
  { href: "#/benchmarks", title: "Benchmarks", sub: "Test results and bodyweight over time" },
  { href: "#/grades", title: "Grade table", sub: "Font and V for boulders, French and YDS for routes" },
  { href: "#/settings", title: "Profile & settings", sub: "Goal, trip, availability, connecting Claude, export" },
  { href: "#/feedback", title: "App feedback", sub: "Bugs and ideas - the coach turns them into GitHub issues" },
];

export default function More() {
  return (
    <div className="page">
      <PageHeader title="More" />
      <nav className="menu">
        {(coachInMore() ? [COACH_LINK, ...LINKS] : LINKS).map((l) => (
          <a key={l.href} href={l.href}>
            <strong>{l.title}</strong>
            <span className="muted small">{l.sub}</span>
          </a>
        ))}
        <button type="button" className="menu-btn" onClick={() => void hardRefreshBrowser()}>
          <strong>Hard refresh</strong>
          <span className="muted small">Clear the cached app and load the latest version</span>
        </button>
      </nav>
    </div>
  );
}
