import type { Preset } from "./types";

export type PhaseKind = "prep" | "hang" | "rest" | "setrest";

export interface Phase {
  kind: PhaseKind;
  duration: number; // seconds
  set: number;
  rep: number;
}

export const PHASE_LABEL: Record<PhaseKind, string> = {
  prep: "Get ready",
  hang: "Hang",
  rest: "Rest",
  setrest: "Set rest",
};

export function buildPhases(p: Preset): Phase[] {
  const phases: Phase[] = [];
  if (p.prep_s > 0) phases.push({ kind: "prep", duration: p.prep_s, set: 1, rep: 1 });
  for (let set = 1; set <= p.sets; set++) {
    for (let rep = 1; rep <= p.reps; rep++) {
      phases.push({ kind: "hang", duration: p.on_s, set, rep });
      if (rep < p.reps) {
        if (p.off_s > 0) phases.push({ kind: "rest", duration: p.off_s, set, rep: rep + 1 });
      } else if (set < p.sets && p.set_rest_s > 0) {
        phases.push({ kind: "setrest", duration: p.set_rest_s, set: set + 1, rep: 1 });
      }
    }
  }
  return phases;
}

export const totalSeconds = (p: Preset) => buildPhases(p).reduce((acc, ph) => acc + ph.duration, 0);

export function clock(s: number): string {
  if (s < 60) return String(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Web Audio beeps. iOS only allows audio after a user gesture, so call unlock() from the Start tap.
export class Beeper {
  private ctx: AudioContext | null = null;

  unlock() {
    try {
      // Safari: play through the silent switch, like a workout app would.
      const session = (navigator as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = "playback";
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
      this.beep(1, 1, 0); // a silent blip finishes unlocking on older iOS
    } catch {
      this.ctx = null;
    }
  }

  beep(freq: number, ms: number, volume = 0.35) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.setValueAtTime(volume, t + ms / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.05);
  }

  countdown = () => this.beep(660, 120);
  hang = () => this.beep(990, 450);
  rest = () => this.beep(440, 350);
  done = () => [0, 220, 440].forEach((d) => setTimeout(() => this.beep(880, 160), d));
}

// Keeps the screen on while the timer runs (iOS 16.4+). Silently does nothing where unsupported.
export class ScreenLock {
  private lock: WakeLockSentinel | null = null;
  private wanted = false;

  private onVisible = () => {
    if (this.wanted && document.visibilityState === "visible") void this.acquire();
  };

  private async acquire() {
    try {
      this.lock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      this.lock = null;
    }
  }

  async start() {
    this.wanted = true;
    document.addEventListener("visibilitychange", this.onVisible);
    await this.acquire();
  }

  stop() {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVisible);
    void this.lock?.release().catch(() => {});
    this.lock = null;
  }
}
