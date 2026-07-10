/**
 * Coreference resolution — replaces pronouns and demonstratives with the
 * most likely referent extracted from recent conversation context.
 *
 * Without this, phrases like "what about it?", "tell me more about that",
 * "is it prime?", and "who invented it?" completely fail the intent detector
 * even when the topic is obvious from the previous turn.
 *
 * Approach: pure token-level heuristics (no external AI). We scan the
 * most recent user/assistant turns for content-bearing nouns, pick the
 * highest-frequency one that isn't a stopword, and splice it in wherever
 * a reference word appears in the new query.
 */

/**
 * Reference patterns — ordered most-to-least ambiguous.
 * We only replace when the WHOLE message is reference-heavy (see guards below).
 * Possessive "its" is intentionally excluded — almost never anaphoric in practice.
 */
const REFERENCE_PATTERNS: RegExp[] = [
  /\bit\b/gi,
  /\bthis\b/gi,
  /\bthat\b/gi,
  /\bthey\b/gi,
  /\bthem\b/gi,
  /\bthe\s+same\b/gi,
  /\bthe\s+topic\b/gi,
  /\bthe\s+subject\b/gi,
  /\bthe\s+thing\b/gi,
];

/**
 * Words that carry no entity/referent value on their own.
 * Slightly broader than a normal stopword list so that verbs and adjectives
 * pulled from "I want to know about X" don't get picked as the referent.
 */
const STOP = new Set([
  "a","an","the","is","are","was","were","be","been","being","of","to","in",
  "on","at","for","with","by","and","or","but","if","so","that","this","these",
  "those","it","its","as","from","do","does","did","can","could","will","would",
  "should","what","who","which","how","why","you","your","i","me","my","we",
  "our","he","she","they","them","their","not","no","tell","know","said","say",
  "about","more","give","show","explain","please","want","like","just","also",
  "very","really","then","than","when","where","there","here","some","any",
  "get","got","has","have","had","been","yes","no","ok","okay","sure","right",
  "well","let","make","go","going","see","look","need","use","used","using",
  // Verbs and adjectives that appear in user turns but are NOT entities:
  "know","think","like","love","hate","find","feel","mean","said","ask",
  "capital","city","country","place","thing","person","name","year","time",
  "much","many","little","big","small","old","new","good","bad","true","false",
  "first","last","next","same","different","other","another","few","several",
]);

/** Return content-bearing tokens from a text string. */
function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Return true only when the message is both:
 *  (a) reference-heavy — contains at least one reference token, AND
 *  (b) subject-poor — has fewer than MIN_CONTENT_TOKENS content-bearing words
 *
 * This double gate prevents innocent short queries like "what is it?"
 * from being corrupted when they are unambiguously self-contained.
 */
const MIN_CONTENT_TOKENS = 2; // fewer than this → subject-poor enough to try coref

function hasReferenceToken(lower: string): boolean {
  return REFERENCE_PATTERNS.some((p) => { p.lastIndex = 0; return p.test(lower); });
}

function needsResolution(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).filter(Boolean).length;

  // Very long queries are always self-sufficient
  if (wordCount > 9) return false;

  // Must actually contain a reference token
  if (!hasReferenceToken(lower)) return false;

  // Count content-bearing tokens (nouns/terms that could stand alone as a query)
  const contentCount = contentTokens(text).length;

  // Only resolve if there are very few independent content tokens
  // (i.e. the message is primarily a reference + question word)
  return contentCount < MIN_CONTENT_TOKENS;
}

/**
 * Score a candidate token for how likely it is to be an entity/topic:
 *  +2  if it starts with a capital letter in the original text (proper noun)
 *  +1  if it is longer than 5 characters (domain terms tend to be longer)
 *  +1  per additional occurrence in the context window (frequency boost)
 */
function entityScore(token: string, rawMessages: string[]): number {
  let score = 0;
  for (const msg of rawMessages) {
    // Count occurrences (case-insensitive)
    const re = new RegExp(`\\b${token}\\b`, "gi");
    const hits = (msg.match(re) ?? []).length;
    score += hits;
    // Capitalization bonus: the word appears capitalised somewhere → likely a proper noun
    const capRe = new RegExp(`\\b${token[0].toUpperCase()}${token.slice(1)}\\b`, "g");
    if (capRe.test(msg)) score += 2;
  }
  if (token.length > 5) score += 1;
  return score;
}

/**
 * Extract the best candidate referent from a list of recent messages.
 * Prefers the most recent user message; uses entity scoring (not raw frequency)
 * to avoid accidentally picking verbs/adjectives as the referent.
 * Returns undefined if nothing useful is found with sufficient confidence.
 */
function findReferent(messages: { role: string; text: string }[]): string | undefined {
  // Collect content tokens from the most recent user message (primary source),
  // then the most recent assistant message (secondary).
  const rawTexts = messages.map((m) => m.text);
  const candidates = new Map<string, number>();

  for (const msg of [...messages].reverse()) {
    const tokens = contentTokens(msg.text);
    if (tokens.length === 0) continue;
    for (const t of tokens) {
      const s = entityScore(t, rawTexts);
      candidates.set(t, Math.max(candidates.get(t) ?? 0, s));
    }
    // Stop after the first non-empty user message (most relevant context)
    if (msg.role === "user" && tokens.length > 0) break;
  }

  if (candidates.size === 0) return undefined;

  const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = sorted[0];

  // Require a minimum entity score to avoid returning low-quality tokens.
  // Score of 0 means no capitalization, single occurrence, and short — likely not an entity.
  if (bestScore < 1) return undefined;

  return best;
}

/**
 * If `text` contains reference words (it, this, that…) and recent context
 * suggests a clear referent, return a version of `text` with the references
 * replaced. Otherwise return `text` unchanged.
 *
 * @param text          The incoming user message.
 * @param recentMessages  Recent turns (oldest-first), role + text pairs.
 */
export function resolveReferences(
  text: string,
  recentMessages: { role: string; text: string }[]
): string {
  if (!needsResolution(text) || recentMessages.length === 0) return text;

  const referent = findReferent(recentMessages);
  if (!referent) return text;

  let resolved = text;
  for (const pat of REFERENCE_PATTERNS) {
    pat.lastIndex = 0;
    resolved = resolved.replace(pat, referent);
  }
  return resolved;
}

/**
 * Extract the likely topic noun from a free-form query.
 * Used by the follow-up handler to know what "tell me more" is about.
 */
export function extractTopic(text: string): string | undefined {
  const tokens = contentTokens(text);
  if (tokens.length === 0) return undefined;
  // Prefer longer words (more likely to be proper nouns / domain terms)
  return tokens.sort((a, b) => b.length - a.length)[0];
}
