/**
 * Session context management: keeps a bounded rolling window of recent turns
 * plus an extractive summary of older ones, so long conversations don't
 * require re-processing full history and don't blow past useful context.
 */
import { stmts, type ConversationRow } from "../db/index.js";
import { tokenize } from "./retrieval.js";

const RECENT_WINDOW = 6; // messages kept verbatim
const SUMMARIZE_THRESHOLD = 20; // once history exceeds this, older turns get folded into a summary

export interface SessionContext {
  recent: ConversationRow[];
  summary: string;
}

/** Extractive summary: pick the highest-frequency non-trivial terms across the given turns. */
function summarize(rows: ConversationRow[]): string {
  const freq = new Map<string, number>();
  for (const r of rows) for (const t of tokenize(r.text)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const topTerms = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  const intents = [...new Set(rows.map((r) => r.intent).filter(Boolean))];
  return `Earlier in this session, the conversation covered: ${topTerms.join(", ") || "general chat"}.` +
    (intents.length ? ` Topics touched: ${intents.join(", ")}.` : "");
}

export function getContext(sessionId: string): SessionContext {
  const all = stmts.getHistory.all(sessionId) as unknown as ConversationRow[];
  if (all.length <= SUMMARIZE_THRESHOLD) {
    return { recent: all.slice(-RECENT_WINDOW), summary: "" };
  }
  const older = all.slice(0, -RECENT_WINDOW);
  const recent = all.slice(-RECENT_WINDOW);
  const existing = stmts.getContextSummary.get(sessionId) as { summary: string } | undefined;
  const summary = existing?.summary || summarize(older);
  if (!existing) stmts.upsertContextSummary.run(sessionId, summary);
  return { recent, summary };
}

/** Call periodically (e.g. every N messages) to refresh the stored summary as history grows. */
export function refreshSummary(sessionId: string): void {
  const all = stmts.getHistory.all(sessionId) as unknown as ConversationRow[];
  if (all.length <= SUMMARIZE_THRESHOLD) return;
  const older = all.slice(0, -RECENT_WINDOW);
  stmts.upsertContextSummary.run(sessionId, summarize(older));
}
