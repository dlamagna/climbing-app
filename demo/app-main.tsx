// The real app, unchanged, talking to the in-browser demo backend instead of Cloudflare.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { setToken } from "../src/api";
import "../src/styles.css";
import "./demo.css";
import "./coach.css";
import { DEMO_TOKEN, type DemoBackend, interceptFetch, startBackend } from "./backend";
import { mountCoachPanel } from "./coach";
import { clearAppCache } from "./store";

export interface DemoHandle {
  backend: DemoBackend;
  show(route: string): void; // opens a route and reloads its data
  reset(): Promise<void>;
}

declare global {
  interface Window {
    climbDemo?: Promise<DemoHandle>;
  }
}

let visit = 0;
const show = (route: string) => {
  // A changed hash remounts the page, so it refetches whatever the coach just wrote.
  location.hash = `#/${route}${++visit > 1 ? `?v=${visit}` : ""}`;
};

async function boot(): Promise<DemoHandle> {
  setToken(DEMO_TOKEN);
  const backend = await startBackend();
  interceptFetch(backend);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  const reset = async () => {
    await backend.reset();
    clearAppCache();
    show("today");
  };
  const handle = { backend, show, reset };
  if (window.parent === window) mountDemoMenu(handle); // inside the desktop page, the page has these controls
  return handle;
}

function mountDemoMenu(demo: DemoHandle) {
  const ui = document.getElementById("demo-ui")!;
  ui.innerHTML = `
    <button class="demo-pill" aria-haspopup="dialog">Demo</button>
    <div class="demo-sheet" role="dialog" aria-label="Demo" hidden>
      <div class="demo-sheet-body">
        <div class="demo-sheet-head">
          <strong>Sample coach</strong>
          <button class="demo-close" aria-label="Close">✕</button>
        </div>
        <div class="coach-panel"></div>
        <div class="demo-sheet-foot">
          <button class="demo-reset">Reset demo data</button>
          <a href="./index.html">About this demo</a>
        </div>
      </div>
    </div>`;
  const sheet = ui.querySelector<HTMLElement>(".demo-sheet")!;
  const open = (on: boolean) => (sheet.hidden = !on);
  ui.querySelector<HTMLButtonElement>(".demo-pill")!.onclick = () => open(true);
  ui.querySelector<HTMLButtonElement>(".demo-close")!.onclick = () => open(false);
  sheet.onclick = (e) => e.target === sheet && open(false);
  ui.querySelector<HTMLButtonElement>(".demo-reset")!.onclick = async () => {
    await demo.reset();
    open(false);
  };
  mountCoachPanel(ui.querySelector(".coach-panel")!, async () => demo.backend, (route, clicked) => {
    show(route);
    if (clicked) open(false);
  });
  // ./app.html?coach opens the sample coach straight away (link from the phone landing page).
  if (new URLSearchParams(location.search).has("coach")) open(true);
}

window.climbDemo = boot();
window.climbDemo.catch((e) => {
  document.getElementById("root")!.innerHTML = `<p class="demo-boot">The demo couldn't start in this browser (${String(e?.message ?? e)}).</p>`;
});
