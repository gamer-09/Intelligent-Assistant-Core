/**
 * Reflection layer: a post-generation check that runs *after* a candidate
 * answer is produced, looking for internal contradictions (e.g. the answer
 * disagrees with a stored correction or a higher-confidence fact) before it
 * is returned to the user. This is deliberately simple and rule-based —
 * no self-critique via a second LLM pass, since none is allowed here.
 */
import { findCorrection } from "../nlp/memory.js";

export interface ReflectionResult {
  text: string;
  flagged: boolean;
  note?: string;
}

/**
 * Check a generated answer against known corrections for the *same*
 * question. If a correction exists but the fresh answer doesn't match it,
 * something is wrong (either the correction lookup was bypassed, or the
 * generator regressed) — surface the correction instead of the fresh text.
 */
export function reflect(question: string, candidateAnswer: string): ReflectionResult {
  const correction = findCorrection(question);
  if (correction && correction.correct_answer.trim() !== candidateAnswer.trim()) {
    return {
      text: correction.correct_answer,
      flagged: true,
      note: "Overrode a fresh answer with a previously taught correction for this exact question.",
    };
  }
  // Sanity check: an empty/placeholder-looking answer should be flagged, never silently returned.
  if (!candidateAnswer || candidateAnswer.trim().length === 0) {
    return { text: "I wasn't able to generate a response for that — could you rephrase?", flagged: true, note: "Generator returned empty output." };
  }
  return { text: candidateAnswer, flagged: false };
}
