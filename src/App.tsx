import { type ComponentType, useEffect, useState } from "react";
import { type ToastMessage, checkToken, flushOutbox, get, getToken, pendingCount, send, setToken, toast } from "./api";
import Benchmarks from "./pages/Benchmarks";
import History from "./pages/History";
import Injuries from "./pages/Injuries";
import Log from "./pages/Log";
import More from "./pages/More";
import Plan from "./pages/Plan";
import Settings from "./pages/Settings";
import Timer from "./pages/Timer";
import Today from "./pages/Today";

const ROUTES: Record<string, ComponentType> = {
  today: Today,
  log: Log,
  timer: Timer,
  history: History,
  more: More,
  plan: Plan,
  injuries: Injuries,
  benchmarks: Benchmarks,
  settings: Settings,
};

const TABS = [
  { route: "today", label: "Today", icon: "◉" },
  { route: "log", label: "Log", icon: "+" },
  { route: "timer", label: "Timer", icon: "◷" },
  { route: "history", label: "History", icon: "▤" },
  { route: "more", label: "More", icon: "≡" },
];
const MORE_ROUTES = ["more", "plan", "injuries", "benchmarks", "settings"];

const currentPath = () => location.hash.replace(/^#\/?/, "");

// Returns the full path including query, so e.g. #/log?edit=5 -> #/log remounts the page.
function usePath() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

// Replays queued offline writes and keeps the server's idea of "today" in the phone's timezone.
async function sync() {
  const sent = await flushOutbox();
  if (sent) toast(`Synced ${sent} offline ${sent === 1 ? "entry" : "entries"}`);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const profile = await get<Record<string, string>>("/profile");
    if (tz && profile.timezone !== tz) await send("PUT", "/profile", { timezone: tz });
  } catch {
    // offline; try next time
  }
}

export default function App() {
  const [authed, setAuthed] = useState(() => Boolean(getToken()));
  const path = usePath();
  const route = path.split("?")[0] || "today";
  const [message, setMessage] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const onAuth = () => setAuthed(false);
    const onToast = (e: Event) => setMessage((e as CustomEvent<ToastMessage>).detail);
    const onOnline = () => void sync();
    window.addEventListener("climb:auth", onAuth);
    window.addEventListener("climb:toast", onToast);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("climb:auth", onAuth);
      window.removeEventListener("climb:toast", onToast);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (authed) void sync();
  }, [authed]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), message.action ? 6000 : 2500); // time to reach for undo
    return () => clearTimeout(id);
  }, [message]);

  if (!authed) return <TokenScreen onDone={() => setAuthed(true)} />;

  const Page = ROUTES[route] ?? Today;
  const activeTab = MORE_ROUTES.includes(route) ? "more" : route;

  return (
    <>
      <main key={path}>
        <Page />
      </main>
      {pendingCount() > 0 && <div className="pending">{pendingCount()} unsynced</div>}
      {message && (
        <div className="toast" role="status">
          {message.message}
          {message.action && (
            <button
              className="toast-action"
              onClick={() => {
                message.action!.run();
                setMessage(null);
              }}
            >
              {message.action.label}
            </button>
          )}
        </div>
      )}
      <nav className="tabbar">
        {TABS.map((t) => (
          <a key={t.route} href={`#/${t.route}`} className={t.route === activeTab ? "on" : ""}>
            <span className="tab-icon" aria-hidden>{t.icon}</span>
            {t.label}
          </a>
        ))}
      </nav>
    </>
  );
}

function TokenScreen({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState(getToken() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await checkToken(value.trim());
      setToken(value.trim());
      onDone();
    } catch (e) {
      setError(e instanceof TypeError ? "No connection - try again with signal." : "That token didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Climb Log</h1>
        <p className="muted">Paste your app token (the APP_TOKEN secret). You only need to do this once on this phone.</p>
      </header>
      <div className="form">
        <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="App token" />
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={!value.trim() || busy} onClick={submit}>Continue</button>
      </div>
    </div>
  );
}
