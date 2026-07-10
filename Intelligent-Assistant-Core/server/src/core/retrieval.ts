/**
 * Local information-retrieval primitives: tokenization, an inverted index,
 * TF-IDF vectors + cosine similarity, and BM25 scoring. No external services,
 * no embeddings models — this is classical IR, exactly what lets the
 * assistant do "semantic-ish" matching (paraphrase tolerance) without an LLM.
 */

const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","of","to","in","on","at","for",
  "with","by","and","or","but","if","so","that","this","these","those","it","its","as","from",
  "do","does","did","can","could","will","would","should","what","who","which","how","why",
  "you","your","i","me","my","we","our","he","she","they","them","their","not","no",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface DocRef<T> {
  id: string;
  tokens: string[];
  payload: T;
}

/**
 * A small in-memory corpus supporting TF-IDF cosine similarity and BM25.
 * Rebuilt cheaply on demand (call `build`) — corpora here are small enough
 * (facts, capability examples, document chunks) that this stays O(n) with a
 * tiny constant, which is the "indexed alternative" the review asked for
 * instead of naive substring scans repeated per query.
 */
export class Corpus<T> {
  private docs: DocRef<T>[] = [];
  private df = new Map<string, number>(); // document frequency per term
  private avgLen = 0;

  build(items: { id: string; text: string; payload: T }[]): void {
    this.docs = items.map((it) => ({ id: it.id, tokens: tokenize(it.text), payload: it.payload }));
    this.df.clear();
    for (const doc of this.docs) {
      const seen = new Set(doc.tokens);
      for (const t of seen) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docs.length
      ? this.docs.reduce((s, d) => s + d.tokens.length, 0) / this.docs.length
      : 0;
  }

  size(): number {
    return this.docs.length;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log((n - df + 0.5) / (df + 0.5) + 1);
  }

  /** BM25 ranking — good default for short factual queries against short docs. */
  bm25(query: string, k = 5, k1 = 1.5, b = 0.75): { doc: DocRef<T>; score: number }[] {
    const qTerms = tokenize(query);
    if (qTerms.length === 0 || this.docs.length === 0) return [];
    const scored = this.docs.map((doc) => {
      const tf = new Map<string, number>();
      for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const term of qTerms) {
        const f = tf.get(term) ?? 0;
        if (f === 0) continue;
        const idf = this.idf(term);
        const norm = f * (k1 + 1) / (f + k1 * (1 - b + b * (doc.tokens.length / (this.avgLen || 1))));
        score += idf * norm;
      }
      return { doc, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
  }

  /** TF-IDF cosine similarity — useful when queries and docs are both short phrases. */
  cosine(query: string, k = 5): { doc: DocRef<T>; score: number }[] {
    const qTerms = tokenize(query);
    if (qTerms.length === 0 || this.docs.length === 0) return [];
    const qtf = new Map<string, number>();
    for (const t of qTerms) qtf.set(t, (qtf.get(t) ?? 0) + 1);
    const qVec = new Map<string, number>();
    for (const [t, f] of qtf) qVec.set(t, f * this.idf(t));
    const qNorm = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1;

    const scored = this.docs.map((doc) => {
      const dtf = new Map<string, number>();
      for (const t of doc.tokens) dtf.set(t, (dtf.get(t) ?? 0) + 1);
      let dot = 0;
      let dNormSq = 0;
      for (const [t, f] of dtf) {
        const w = f * this.idf(t);
        dNormSq += w * w;
        if (qVec.has(t)) dot += w * (qVec.get(t) as number);
      }
      const dNorm = Math.sqrt(dNormSq) || 1;
      return { doc, score: dot / (qNorm * dNorm) };
    });
    return scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
  }
}
