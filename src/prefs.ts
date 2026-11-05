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

const REVIEW_DISMISSED_KEY = "climb.reviewDismissed";

// The automatic review start (routine_starts id) whose "did not complete" prompt was dismissed (#94).
export function dismissedReview(): number | null {
  try {
    const n = Number(localStorage.getItem(REVIEW_DISMISSED_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function dismissReview(startId: number) {
  try {
    localStorage.setItem(REVIEW_DISMISSED_KEY, String(startId));
  } catch {
    // the prompt shows again next time
  }
}

const COACH_IN_MORE_KEY = "climb.coachInMore";

// Show Coach under More instead of in the bottom tab bar (#99). Off unless switched on.
export function coachInMore(): boolean {
  try {
    return localStorage.getItem(COACH_IN_MORE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setCoachInMore(on: boolean) {
  try {
    if (on) localStorage.setItem(COACH_IN_MORE_KEY, "on");
    else localStorage.removeItem(COACH_IN_MORE_KEY);
  } catch {
    // stays at the default
  }
  window.dispatchEvent(new Event("climb:prefs"));
}
