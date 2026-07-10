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

export interface SubtaskResult { subtask: string; answer: string; failed?: boolean; }

// Verification (review §7: "can Yang verify completion / recover from
// failure?"). Previously subtasks were executed and stitched together
// blindly — a failed step ("I didn't quite catch that") was presented with
// the same confidence as a successful one, and nothing checked or flagged
// it. This scans each subtask's answer for known failure signatures so the
// stitched response honestly reports which steps didn't complete instead of
// silently passing failure through as if it were a real answer.
const FAILURE_SIGNATURES: RegExp[] = [
  /^i didn't quite catch that/i,
  /^i'm not confident i understood/i,
  /^i don't have a built-in explanation/i,
  /^i don't have a previous question/i,
  /wasn't able to generate a response/i,
];

export function markFailures(results: SubtaskResult[]): SubtaskResult[] {
  return results.map((r) => ({ ...r, failed: FAILURE_SIGNATURES.some((p) => p.test(r.answer.trim())) }));
}

export function stitchAnswers(results: SubtaskResult[]): string {
  const marked = markFailures(results);
  if (marked.length === 1) return marked[0].answer;
  const body = marked.map((r, i) => `**${i + 1}. ${r.subtask}**${r.failed ? " ⚠️ _(this step did not complete)_" : ""}\n${r.answer}`).join("\n\n");
  const failedCount = marked.filter((r) => r.failed).length;
  const footer = failedCount > 0
    ? `\n\n---\n${failedCount} of ${marked.length} step(s) above didn't complete successfully — see the ⚠️ markers.`
    : "";
  return body + footer;
}
