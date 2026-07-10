/**
 * Planner: splits a compound request ("what's 5+5 and also tell me a joke")
 * into ordered subtasks so each can be routed through the pipeline
 * independently, then stitches the answers back together — instead of the
 * whole message being force-fit into a single intent.
 */

const SPLIT_PATTERN = /\s*(?:,?\s+and\s+then\s+|,?\s+then\s+|\s+and\s+also\s+|;\s*)\s*/i;

/**
 * Split into subtasks only when there's reasonably strong evidence of a
 * compound request (an explicit connector AND at least two "actionable"
 * fragments) — otherwise leave single sentences alone so we don't
 * over-split ordinary text ("bread and butter").
 */
export function splitCompoundRequest(text: string): string[] {
  if (!/\b(and then|then|and also|;)\b/i.test(text)) return [text];
  const parts = text.split(SPLIT_PATTERN).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [text];
  // Require each part to look like its own actionable fragment (has a verb-ish word or is long enough).
  const actionable = parts.filter((p) => p.split(/\s+/).length >= 2);
  if (actionable.length < 2) return [text];
  return parts;
}

export interface SubtaskResult { subtask: string; answer: string; }

export function stitchAnswers(results: SubtaskResult[]): string {
  if (results.length === 1) return results[0].answer;
  return results.map((r, i) => `**${i + 1}. ${r.subtask}**\n${r.answer}`).join("\n\n");
}
