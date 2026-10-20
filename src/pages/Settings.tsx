import { useEffect, useState } from "react";
import { fetchFile, savedToast, send, setToken, toast, useApi } from "../api";
import { CoachActivity } from "../components/coachActivity";
import { Card, Chips, Field, PageHeader } from "../components/ui";
import { popupsEnabled, setPopupsEnabled } from "../prefs";

// Free-form profile facts; Claude reads all of them when planning.
const FIELDS = [
  { key: "goal", label: "Goal for this block", placeholder: "e.g. Get fit for the trip, climb 7a outdoors" },
  { key: "trip_date", label: "Trip date", type: "date" },
  { key: "trip_details", label: "Trip", placeholder: "Where, what style (sport, boulder, multipitch)" },
  { key: "level", label: "Current level", placeholder: "e.g. boulder 6B+, lead 6c" },
  { key: "weekly_availability", label: "When can you train?", placeholder: "e.g. Mon/Wed gym 2h, Sat outdoor, hangboard at home" },
  { key: "gym_setup", label: "Equipment", placeholder: "e.g. Beastmaker 1000 at home, gym has a Moonboard" },
];

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// A home-screen web app on iOS has no download UI (a blob link opens a preview you can't leave), so
// there the file goes to the share sheet, which has "Save to Files". Elsewhere it's a normal download.
async function saveFile(file: File) {
  if (isStandalone() && navigator.canShare?.({ files: [file] })) {
    const share = () => navigator.share({ files: [file] }).catch(() => {});
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      // Safari can expire the tap's permission while the export downloads; a second tap shares it.
      if ((e as Error).name === "NotAllowedError") toast("Export ready", { label: "Save", run: share }, 15000);
      // AbortError: the share sheet was closed.
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function Settings() {
  const { data } = useApi<Record<string, string>>("/profile");
  const [profile, setProfile] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setProfile(data); }, [data]);

  async function save() {
    const values = Object.fromEntries(FIELDS.map((f) => [f.key, profile[f.key]?.trim() || null]));
    savedToast(await send("PUT", "/profile", values), "Profile saved");
  }

  const [popups, setPopups] = useState(popupsEnabled);
  function changePopups(on: boolean) {
    setPopupsEnabled(on);
    setPopups(on);
  }

  const [exporting, setExporting] = useState(false);
  async function exportData() {
    setExporting(true);
    try {
      await saveFile(await fetchFile("/export"));
    } catch (e) {
      toast(e instanceof TypeError ? "Export needs a connection" : (e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  function signOut() {
    if (!confirm("Forget the app token on this phone?")) return;
    setToken(null);
    location.reload();
  }

  return (
    <div className="page">
      <PageHeader title="Profile & settings" back="#/more" />
      <Card title="Profile" >
        <p className="muted small">Claude reads this when planning and recommending.</p>
        <div className="form">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === "date" ? (
                <input type="date" value={profile[f.key] ?? ""} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })} />
              ) : (
                <textarea rows={2} value={profile[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })} />
              )}
            </Field>
          ))}
          <button className="btn primary block" onClick={save}>Save profile</button>
        </div>
      </Card>
      <Card title="Pop-ups">
        <p className="small">
          The weekly "which days will you climb?" question opens as a pop-up. Switched off, it only shows as a card on Today, and you can
          still plan your days any time with <em>Plan my climbing days</em>. Saved on this phone.
        </p>
        <Chips
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          value={popups ? "on" : "off"}
          onChange={(v) => v && changePopups(v === "on")}
        />
      </Card>
      <CoachActivity />
      <Card title="Connect Claude">
        <p className="small">Add a custom connector in Claude (Settings → Connectors) with this URL, using your MCP token:</p>
        <code className="block-code">{location.origin}/mcp/&lt;MCP_TOKEN&gt;</code>
        <p className="small">Then ask things like <em>"How should I train today?"</em> or <em>"How did my sleep and drinking affect my sessions this month?"</em></p>
      </Card>
      <Card title="Your data">
        <p className="small">Download everything you've logged as one JSON file, to keep as a backup or open elsewhere.</p>
        <button className="btn block" onClick={exportData} disabled={exporting}>
          {exporting ? "Exporting..." : "Export my data"}
        </button>
      </Card>
      <button className="btn danger block" onClick={signOut}>Sign out of this phone</button>
    </div>
  );
}
