/**
 * Session context management: keeps a bounded rolling window of recent turns
 * plus an extractive summary of older ones, so long conversations don't
 * require re-processing full history and don't blow past useful context.
 *
 * Audit improvements:
 *  - Added `getLastTopic()` for coreference resolution
 *  - Added `getLastUserQuery()` for follow-up handling
 *  - Improved extractive summary to preserve intent-bearing terms
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

// ── New helpers for follow-up & coreference ──────────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","of","to","in",
  "on","at","for","with","by","and","or","but","if","so","that","this","these",
  "those","it","its","as","from","do","does","did","can","could","will","would",
  "should","what","who","which","how","why","you","your","i","me","my","we",
  "our","he","she","they","them","their","not","no","tell","know","about",
  "more","give","show","explain","please","want","like","just","also","ok",
  "okay","sure","right","well","yes","no","get","let","make","go","see",
]);

/**
 * Extract the most likely topic from a piece of text (the first content-bearing
 * noun/term that isn't a stopword). Used for follow-up resolution and coref.
 */
function extractTopicFromText(text: string): string | undefined {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (tokens.length === 0) return undefined;
  // Prefer the longest token (more likely to be a domain term)
  return tokens.sort((a, b) => b.length - a.length)[0];
}

/**
 * Return the most likely topic the session was discussing, inferred from
 * the most recent user message. Used by the follow-up handler.
 */
export function getLastTopic(sessionId: string): string | undefined {
  const row = stmts.getLastUserMessage.get(sessionId) as unknown as ConversationRow | undefined;
  if (!row) return undefined;
  return extractTopicFromText(row.text);
}

/**
 * Return the full text of the most recent user message in a session.
 */
export function getLastUserQuery(sessionId: string): string | undefined {
  const row = stmts.getLastUserMessage.get(sessionId) as unknown as ConversationRow | undefined;
  return row?.text;
}

/**
 * Return the full text of the most recent assistant response in a session.
 */
export function getLastAssistantResponse(sessionId: string): string | undefined {
  const row = stmts.getLastAssistantMessage.get(sessionId) as unknown as ConversationRow | undefined;
  return row?.text;
}
