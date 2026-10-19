// Settings kept on this phone only (not synced, not read by Claude). Storage can throw (private mode,
// blocked site data); the defaults apply then.

const POPUPS_KEY = "climb.popups";

// Pop-ups such as the weekly "which days will you climb" question (#54). On unless switched off (#56).
export function popupsEnabled(): boolean {
  try {
    return localStorage.getItem(POPUPS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setPopupsEnabled(on: boolean) {
  try {
    if (on) localStorage.removeItem(POPUPS_KEY);
    else localStorage.setItem(POPUPS_KEY, "off");
  } catch {
    // stays at the default
  }
}
