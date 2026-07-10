/**
 * Confidence scoring + explainable phrasing. The pipeline attaches a
 * confidence score to every step (intent detection, retrieval match,
 * reasoning); this module turns that into consistent human-facing language
 * and gates whether the answer should be hedged.
 */

export type ConfidenceLevel = "high" | "medium" | "low";

export function levelFor(score: number): ConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

/** Combine several independent confidence signals (e.g. intent + retrieval) conservatively. */
export function combineConfidence(scores: number[]): number {
  const valid = scores.filter((s) => Number.isFinite(s));
  if (valid.length === 0) return 0;
  // Geometric-mean-ish combination: penalizes any single weak signal more than an average would.
  const product = valid.reduce((p, s) => p * Math.max(s, 0.01), 1);
  return Math.pow(product, 1 / valid.length);
}

/** Prefix a response with a hedge when confidence is low/medium, leave high-confidence answers untouched. */
export function hedge(text: string, score: number): string {
  const level = levelFor(score);
  if (level === "high") return text;
  if (level === "medium") return `${text}\n\n*(medium confidence — let me know if this isn't quite right)*`;
  return `${text}\n\n*(low confidence — I'm not fully sure here; feel free to correct me)*`;
}
