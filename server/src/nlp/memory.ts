/**
 * Growth & self-correction layer — still no external AI APIs.
 *
 * This module is how the assistant "learns":
 *  - `teachFact` / `recallFact`   → explicit facts a user tells it to remember
 *  - `learnCorrection`            → fixes a wrong answer so it isn't repeated
 *  - `findCorrection`             → checked before generating a fresh answer
 *  - `noteResearchGap`            → records topics it didn't know, for later teaching
 *
 * Everything is stored locally in the same SQLite file as conversation
 * history — no network calls, no third-party services.
 */
import { stmts, type LearnedFactRow, type ResearchGapRow } from "../db/index.js";

/** Normalize a query into a stable lookup key so paraphrases still match. */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ");
}

export function teachFact(key: string, value: string): void {
  stmts.upsertFact.run(normalizeQuery(key), value.trim());
  stmts.resolveGapsForTopic.run(normalizeQuery(key));
}

export function recallFact(key: string): LearnedFactRow | undefined {
  return stmts.getFact.get(normalizeQuery(key)) as unknown as LearnedFactRow | undefined;
}

export function listFacts(): LearnedFactRow[] {
  return stmts.listFacts.all() as unknown as LearnedFactRow[];
}

/** Find a taught fact whose key is contained in (or contains) the given text. */
export function findFactMatch(text: string): LearnedFactRow | undefined {
  const lower = normalizeQuery(text);
  for (const fact of listFacts()) {
    if (lower.includes(fact.key)) return fact;
  }
  return undefined;
}

export function learnCorrection(queryPattern: string, correctAnswer: string, wrongAnswer?: string): void {
  const key = normalizeQuery(queryPattern);
  stmts.upsertCorrection.run(key, wrongAnswer ?? null, correctAnswer.trim());
  stmts.resolveGapsForTopic.run(key);
}

export function findCorrection(queryPattern: string) {
  const key = normalizeQuery(queryPattern);
  const row = stmts.getCorrection.get(key) as { correct_answer: string } | undefined;
  if (row) stmts.bumpCorrectionUse.run(key);
  return row;
}

export function noteResearchGap(topic: string): void {
  stmts.insertResearchGap.run(normalizeQuery(topic));
}

export function listOpenGaps(): ResearchGapRow[] {
  return stmts.listOpenGaps.all() as unknown as ResearchGapRow[];
}
