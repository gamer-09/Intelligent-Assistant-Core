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

/** Reference words that may stand in for an earlier topic. */
const REFERENCE_PATTERNS: RegExp[] = [
  /\bit\b/gi,
  /\bits\b/gi,
  /\bthis\b/gi,
  /\bthat\b/gi,
  /\bthey\b/gi,
  /\bthem\b/gi,
  /\btheir\b/gi,
  /\bthose\b/gi,
  /\bthese\b/gi,
  /\bthe\s+same\b/gi,
  /\bthe\s+topic\b/gi,
  /\bthe\s+subject\b/gi,
  /\bthe\s+thing\b/gi,
  /\bsuch\s+(?:a\s+)?thing\b/gi,
];

/** Words that carry no referent value on their own. */
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
 * Determine whether `text` is reference-heavy enough to warrant resolution.
 * We only resolve when:
 *  - the message is short (≤ 7 words), OR
 *  - it contains a reference word AND no strong subject noun
 */
function needsResolution(text: string): boolean {
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).length;
  if (wordCount > 10) return false; // long queries are self-sufficient
  return REFERENCE_PATTERNS.some((p) => { p.lastIndex = 0; return p.test(lower); });
}

/**
 * Extract the best candidate referent from a list of recent messages.
 * Prefers the most recent user message; falls back to assistant messages.
 * Returns undefined if nothing useful is found.
 */
function findReferent(messages: { role: string; text: string }[]): string | undefined {
  // Walk backwards through recent messages looking for content nouns
  const candidates: string[] = [];
  for (const msg of [...messages].reverse()) {
    const tokens = contentTokens(msg.text);
    if (tokens.length === 0) continue;
    // Prefer user messages — they stated the topic
    if (msg.role === "user") {
      candidates.push(...tokens);
      break;
    }
    candidates.push(...tokens.slice(0, 3));
    if (candidates.length >= 5) break;
  }

  if (candidates.length === 0) return undefined;

  // Count frequency; the most-mentioned term is probably the referent
  const freq = new Map<string, number>();
  for (const t of candidates) freq.set(t, (freq.get(t) ?? 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0];
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
