// Bottom tab bar layout. Coach can live under More to free a slot (#99).

export interface Tab {
  route: string;
  label: string;
  icon: string;
}

const COACH_TAB: Tab = { route: "coach", label: "Coach", icon: "✦" };

export const BASE_TABS: Tab[] = [
  { route: "today", label: "Today", icon: "◉" },
  { route: "log", label: "Log", icon: "+" },
  { route: "timer", label: "Timer", icon: "◷" },
  { route: "history", label: "History", icon: "▤" },
  { route: "more", label: "More", icon: "≡" },
];

export function tabsFor(coachInMore: boolean): Tab[] {
  if (coachInMore) return BASE_TABS;
  const tabs = [...BASE_TABS];
  tabs.splice(3, 0, COACH_TAB);
  return tabs;
}

// Which tab is highlighted for a route. Coach counts as part of More when it has no tab of its own.
export function activeTabFor(route: string, coachInMore: boolean, moreRoutes: string[]): string {
  if (route === "coach") return coachInMore ? "more" : "coach";
  if (moreRoutes.includes(route)) return "more";
  return route === "checkin" ? "history" : route;
}
