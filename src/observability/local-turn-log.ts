/**
 * Local dev turn debug log — JSONL file under logs/turn-debug.jsonl.
 * Enabled when LOCAL_TURN_LOG=on or LOG_LEVEL=debug (wrangler dev only).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../env.js';

export interface LocalTurnLogEntry {
  ts: string;
  thread_id: string;
  turn_index: number;
  channel: string;
  input_source?: string;
  action_id?: string;
  buyer_text: string;
  reply_preview: string;
  phase: string;
  focus?: { project_id: string; name: string };
  constraints: Record<string, unknown>;
  last_offered: Array<{ project_id: string; name: string }>;
  extracted: {
    ask_topics?: string[];
    named_projects?: string[];
    pick_name?: string;
    transition?: string;
    affirm?: boolean;
    wants_more?: boolean;
    constraints?: Record<string, unknown>;
    /** SA: chip resolve vs unknown (corpus: promote frequent unknowns). */
    speech_act?: string;
    chip_path_ids?: string[];
  };
  switch_intent?: unknown;
  goal: unknown;
  tools: string[];
  extract_provenance?: unknown;
  routing?: string;
  rti?: {
    last_ui_mode?: string;
    last_goal_kind?: string;
    pending_prompt?: unknown;
  };
  grounding?: string;
  /** Failure-as-a-value Phase 0 safe summaries; no internal detail/copy. */
  failures?: import('../engine/outcome.js').FailureSummary[];
  /** Set on early-exit turns (RTI probe, type floor, etc.). */
  exit?: string;
}

const LOG_DIR = 'logs';
const LOG_FILE = 'logs/turn-debug.jsonl';

export function localTurnLogEnabled(env: Env): boolean {
  return env.LOCAL_TURN_LOG === 'on' || env.LOG_LEVEL === 'debug';
}

export function localTurnLogPath(): string {
  return LOG_FILE;
}

let warnedNoFilesystem = false;

export function emitLocalTurnLog(env: Env, entry: LocalTurnLogEntry): void {
  if (!localTurnLogEnabled(env)) return;
  const line = `${JSON.stringify(entry)}\n`;
  try {
    syncAppendLogLine(line);
  } catch {
    // This catch branch is the DEPLOYED branch. `node:fs` does not exist in a
    // Worker isolate, so appendFileSync always throws off a laptop — and
    // LOCAL_TURN_LOG is "on" in three deployed environments (dev, ctrldev,
    // projdev). It used to console.log `line`, which is the whole entry:
    // buyer_text verbatim, reply_preview, and the buyer's constraints. Every
    // turn on those three Workers wrote a buyer's message into Workers Logs,
    // where it sits under Cloudflare's retention rather than ours.
    //
    // The notice carries no entry data and fires once per isolate, so a
    // developer whose logs/turn-debug.jsonl stays empty learns why.
    if (!warnedNoFilesystem) {
      warnedNoFilesystem = true;
      console.warn('[turn-debug] no filesystem in this runtime — local turn log is wrangler-dev only');
    }
  }
}

function syncAppendLogLine(line: string): void {
  const root = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
  const dir = join(root, LOG_DIR);
  const file = join(root, LOG_FILE);
  mkdirSync(dir, { recursive: true });
  appendFileSync(file, line, 'utf8');
}
