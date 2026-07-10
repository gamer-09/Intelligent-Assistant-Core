/**
 * Semantic (paraphrase-tolerant) intent matching: builds a BM25 corpus from
 * each intent's example phrases + keywords, so an utterance that shares no
 * regex pattern but overlaps meaningfully in vocabulary ("what's the deal
 * with prime numbers" vs. "is X prime") can still be routed correctly.
 * Used as a *fallback/booster*, not a replacement, for the fast regex path
 * in intent-detector.ts — regex stays first because it's precise and cheap;
 * this catches the paraphrases regex misses.
 */
import { Corpus } from "./retrieval.js";

export interface IntentExample { intent: string; text: string; }

let corpus: Corpus<{ intent: string }> | null = null;

export function buildSemanticIndex(examples: IntentExample[]): void {
  corpus = new Corpus<{ intent: string }>();
  corpus.build(examples.map((e, i) => ({ id: String(i), text: e.text, payload: { intent: e.intent } })));
}

export interface SemanticMatch { intent: string; score: number; }

/** Returns the best-matching intent by BM25 over example phrases, or undefined if nothing scores. */
export function semanticMatch(text: string): SemanticMatch | undefined {
  if (!corpus || corpus.size() === 0) return undefined;
  const hits = corpus.bm25(text, 5);
  if (hits.length === 0) return undefined;
  // Aggregate score per intent (multiple examples of the same intent can each contribute).
  const byIntent = new Map<string, number>();
  for (const { doc, score } of hits) {
    byIntent.set(doc.payload.intent, (byIntent.get(doc.payload.intent) ?? 0) + score);
  }
  const [intent, score] = [...byIntent.entries()].sort((a, b) => b[1] - a[1])[0];
  // Normalize roughly into 0..1 range for combination with regex confidence.
  return { intent, score: Math.min(1, score / 6) };
}
