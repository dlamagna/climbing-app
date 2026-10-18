// Pieces shared by the MCP tool lists in worker/mcp.ts and worker/mcp-writes.ts.

import { type Env, getProfile, todayIn } from "./db";

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  enabled?: (env: Env) => boolean; // hidden from tools/list when false
  run: (args: any, env: Env) => Promise<unknown>;
}

export const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" };

// Today in the climber's timezone (profile.timezone, set by the app).
export async function todayFor(env: Env): Promise<string> {
  return todayIn((await getProfile(env.DB)).timezone);
}

// The date a tool was given, defaulting to today in the climber's timezone.
export async function today(env: Env, date?: string): Promise<string> {
  return date || todayFor(env);
}
