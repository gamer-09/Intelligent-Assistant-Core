/**
 * Ranked memory retrieval: when multiple taught facts could match a query,
 * score candidates by relevance + recency + verification instead of
 * returning the first substring match (the prior behavior).
 */
import { stmts, type LearnedFactRow } from "../db/index.js";
import { normalizeQuery } from "../nlp/memory.js";
import { Corpus } from "./retrieval.js";

export interface RankedFact extends LearnedFactRow {
  score: number;
}

function recencyBoost(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / 86_400_000;
  // Decays slowly; recently taught/updated facts rank slightly higher when otherwise tied.
  return 1 / (1 + Math.log1p(Math.max(ageDays, 0)));
}

/** Rank all learned facts against a query, combining BM25 relevance with recency. */
export function rankFacts(query: string, limit = 5): RankedFact[] {
  const facts = stmts.listFacts.all() as unknown as LearnedFactRow[];
  if (facts.length === 0) return [];

  const corpus = new Corpus<LearnedFactRow>();
  corpus.build(facts.map((f) => ({ id: String(f.id), text: `${f.key} ${f.value}`, payload: f })));
  const hits = corpus.bm25(query, facts.length);

  const q = normalizeQuery(query);
  const scored: RankedFact[] = hits.map(({ doc, score }) => {
    const fact = doc.payload;
    const exactSubstring = q.includes(fact.key) ? 1.5 : 0;
    const combined = score + exactSubstring + 0.5 * recencyBoost(fact.updated_at);
    return { ...fact, score: combined };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Best single match, or undefined if nothing scores above a minimal relevance floor. */
export function bestFactMatch(query: string): RankedFact | undefined {
  const ranked = rankFacts(query, 1);
  return ranked[0] && ranked[0].score > 0 ? ranked[0] : undefined;
}
