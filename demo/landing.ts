// The demo's front page. On a computer the real app runs in a phone frame next to the tour; on a phone
// the links open the app full screen.

import "./landing.css";
import "./coach.css";
import type { DemoHandle } from "./app-main";
import { forgetDemo } from "./store";
import { mountCoachPanel } from "./coach";

const FEATURES = [
  { route: "today", title: "Morning check-in", text: "Sleep, feeling, drinks, protein: three taps. Readiness and today's plan right under it." },
  { route: "log", title: "Log a session", text: "Type, time, effort. Training load is worked out for you; grades, style tags and gym are optional." },
  { route: "timer", title: "Hangboard timer", text: "Max hangs, repeaters, 7/53 and more, or your own presets. Every run is logged by itself." },
  { route: "history", title: "History and load", text: "Calendar, weekly load with finger load split out, and the mix of rope, boulder and fingers." },
  { route: "plan", title: "Training plan", text: "Written around your goals. Each day shows done, partial, swapped or missed." },
  { route: "injuries", title: "Injury tracking", text: "Only there when you're hurt: daily pain trend, red flags, and a check on old session notes." },
  { route: "benchmarks", title: "Progress", text: "Max hangs, pull-ups, bodyweight and hardest grade over time." },
  { route: "grades", title: "Grade table", text: "Font, V, French and YDS side by side." },
  { route: "feedback", title: "App feedback", text: "Ideas typed in the app get filed as GitHub issues by the nightly review." },
  { route: "settings", title: "Profile and export", text: "Goals, trip and availability for the coach; export everything as JSON or CSV." },
];

const desktop = matchMedia("(min-width: 960px)");
const frame = document.getElementById("app") as HTMLIFrameElement;

// The app in the frame exposes window.climbDemo once its backend is up.
function app(): Promise<DemoHandle> {
  if (!frame.src) frame.src = "./app.html";
  return new Promise((resolve) => {
    const poll = () => {
      const handle = (frame.contentWindow as (Window & { climbDemo?: Promise<DemoHandle> }) | null)?.climbDemo;
      if (handle) handle.then(resolve);
      else setTimeout(poll, 50);
    };
    poll();
  });
}

let active: HTMLElement | null = null;
const features = document.getElementById("features")!;
for (const f of FEATURES) {
  const a = document.createElement("a");
  a.className = "feature";
  a.href = `./app.html#/${f.route}`;
  a.innerHTML = `<strong></strong><span></span>`;
  a.querySelector("strong")!.textContent = f.title;
  a.querySelector("span")!.textContent = f.text;
  a.onclick = (e) => {
    if (!desktop.matches) return; // phone: follow the link, full screen
    e.preventDefault();
    active?.classList.remove("on");
    (active = a).classList.add("on");
    void app().then((h) => h.show(f.route));
  };
  features.append(a);
}

for (const b of document.querySelectorAll<HTMLButtonElement>(".reset")) {
  b.onclick = async () => {
    b.disabled = true;
    if (frame.src) await (await app()).reset();
    else await forgetDemo();
    b.disabled = false;
    b.textContent = "done, fresh data";
    setTimeout(() => (b.textContent = b.dataset.label!), 2000);
  };
  b.dataset.label = b.textContent!;
}

let coachMounted = false;
function startDesktop() {
  if (!desktop.matches) return;
  void app();
  if (coachMounted) return;
  coachMounted = true;
  mountCoachPanel(
    document.getElementById("coach")!,
    async () => (await app()).backend,
    (route) => void app().then((h) => h.show(route)),
  );
}
startDesktop();
desktop.addEventListener("change", startDesktop);
