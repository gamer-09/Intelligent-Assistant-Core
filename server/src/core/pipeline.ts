/**
 * Modular reasoning pipeline — the explicit orchestration layer replacing
 * "one big switch statement gets called directly from the route handler". Stages:
 *
 *   1. context      — load recent turns + rolling summary
 *   2. coref        — resolve pronouns/demonstratives from recent context
 *   3. planning      — split compound requests into ordered subtasks
 *   4. NLU           — regex intent detection, boosted by semantic (BM25)
 *                      matching when regex confidence is weak
 *   5. generation    — intent handlers
 *   6. reflection    — sanity/contradiction check against known corrections
 *   7. confidence    — combine signals, optionally hedge or ask clarification
 *
 * Audit improvements:
 *  - Coreference resolution pass before NLU
 *  - Low-confidence path emits a targeted clarifying question instead of
 *    a generic hedge, so users know exactly what to clarify
 *  - Trace now records the coref pass result for explainability
 */
import { detectIntent, type DetectedIntent } from "../nlp/intent-detector.js";
import { generateResponse } from "../nlp/response-generator.js";
import { getContext } from "./contextManager.js";
import { splitCompoundRequest, stitchAnswers, type SubtaskResult } from "./planner.js";
import { semanticMatch } from "./semantic.js";
import { reflect } from "./reflection.js";
import { combineConfidence, hedge } from "./confidence.js";
import { observeMessage } from "./userModel.js";
import { resolveReferences } from "../nlp/coref.js";
import type { ConversationRow } from "../db/index.js";

export interface PipelineTraceStep { stage: string; detail: string; }

export interface PipelineResult {
  text: string;
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  trace: PipelineTraceStep[];
}

const lastTraceBySession = new Map<string, PipelineTraceStep[]>();

export function getLastTrace(sessionId: string): PipelineTraceStep[] {
  return lastTraceBySession.get(sessionId) ?? [];
}

// ── Clarifying question generator ────────────────────────────────────────────

/**
 * When confidence is very low and all resolution attempts fail, generate a
 * targeted clarifying question rather than a generic "I didn't catch that"
 * message. Uses simple heuristics on the input text.
 */
function buildClarifyingQuestion(text: string): string {
  const lower = text.toLowerCase().trim();

  // Question words with no clear subject
  if (/^(?:why|how|when|where|who|what)\s*\??\s*$/.test(lower)) {
    return `I'd be happy to help! Could you give me a bit more context? For example: "Why is [something]?", "How does [topic] work?", or "What is [concept]?"`;
  }

  // Very short / single word
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const term = words[0];
    return `I see you typed **"${term}"** — could you give me a bit more context? For example:\n- "What is ${term}?"\n- "Tell me about ${term}"\n- "Calculate ${term}"\n\nOr visit the **Guide** page for the full list of things I can do.`;
  }

  // Contains a pronoun with no clear referent
  if (/\b(?:it|that|this|they|them)\b/i.test(lower) && words.length < 5) {
    return `I'm not sure what you're referring to with "${text.trim()}". Could you be more specific? For example, name the topic directly.`;
  }

  // Generic clarification with specific suggestions
  const suggestions = [
    `**Math**: "What is 15 × 7?"`,
    `**Knowledge**: "Tell me about France"`,
    `**Convert**: "Convert 100°F to Celsius"`,
    `**Teach me**: "Remember that X is Y"`,
    `**Help**: "What can you do?"`,
  ];
  return `I couldn't quite make out what you meant by: *"${text.trim()}"*\n\nCould you rephrase? Here are some things I understand:\n${suggestions.map(s => `• ${s}`).join("\n")}`;
}

// ── Core single-subtask runner ────────────────────────────────────────────────

async function runSingle(
  text: string,
  sessionId: string,
  trace: PipelineTraceStep[],
  contextSummary: string,
  tavilyApiKey?: string
): Promise<{ detected: DetectedIntent; answer: string }> {
  let detected = detectIntent(text);
  trace.push({ stage: "nlu", detail: `regex intent="${detected.intent}" confidence=${detected.confidence.toFixed(2)}` });

  // Boost/rescue with semantic (BM25) matching when regex confidence is weak
  if (detected.confidence < 0.5) {
    const semanticInput = contextSummary ? `${contextSummary} ${text}` : text;
    const semantic = semanticMatch(semanticInput);
    if (semantic && semantic.score > detected.confidence) {
      trace.push({ stage: "semantic", detail: `semantic intent="${semantic.intent}" score=${semantic.score.toFixed(2)} (overrides weak regex match)` });
      detected = { ...detected, intent: semantic.intent, confidence: combineConfidence([detected.confidence || 0.1, semantic.score]) };
    } else if (semantic) {
      trace.push({ stage: "semantic", detail: `semantic intent="${semantic.intent}" score=${semantic.score.toFixed(2)} (did not exceed regex, ignored)` });
    }
  }

  // Trace intent is handled here to avoid circular imports
  let raw: string;
  if (detected.intent === "trace") {
    raw = formatTrace(lastTraceBySession.get(sessionId) ?? []);
  } else {
    raw = await generateResponse(text, detected, sessionId, tavilyApiKey);
  }
  trace.push({ stage: "generation", detail: `handler for intent="${detected.intent}" produced ${raw.length} chars` });

  const reflected = reflect(text, raw);
  if (reflected.flagged) trace.push({ stage: "reflection", detail: reflected.note ?? "flagged" });

  return { detected, answer: reflected.text };
}

// ── Main pipeline entry point ─────────────────────────────────────────────────

export async function runPipeline(text: string, sessionId: string, tavilyApiKey?: string): Promise<PipelineResult> {
  const trace: PipelineTraceStep[] = [];
  const context = getContext(sessionId);
  trace.push({ stage: "context", detail: `${context.recent.length} recent turn(s) in window${context.summary ? "; older turns summarized" : ""}` });
  observeMessage(sessionId, text);

  // ── Coreference resolution ────────────────────────────────────────────────
  // Replace "it", "that", "this" etc. with the referent from recent turns.
  const recentMessages = context.recent.map((r: ConversationRow) => ({ role: r.role, text: r.text }));
  const resolved = resolveReferences(text, recentMessages);
  if (resolved !== text) {
    trace.push({ stage: "coref", detail: `resolved reference: "${text}" → "${resolved}"` });
  }
  // Use the resolved text for all downstream processing
  const workingText = resolved;

  // ── Planning ──────────────────────────────────────────────────────────────
  const subtasks = splitCompoundRequest(workingText);
  trace.push({ stage: "planning", detail: subtasks.length > 1 ? `split into ${subtasks.length} subtasks` : "single-step request, no split needed" });

  const results: SubtaskResult[] = [];
  let primaryDetected: DetectedIntent | null = null;
  const confidences: number[] = [];

  for (const subtask of subtasks) {
    const { detected, answer } = await runSingle(subtask, sessionId, trace, context.summary, tavilyApiKey);
    results.push({ subtask, answer });
    confidences.push(detected.confidence || 0.1);
    if (!primaryDetected) primaryDetected = detected;
  }

  const combined = combineConfidence(confidences);
  const stitched = stitchAnswers(results);

  // ── Confidence & response finishing ──────────────────────────────────────
  let finalText: string;
  if (subtasks.length > 1) {
    finalText = stitched;
  } else if (combined < 0.15 && (primaryDetected?.intent === "unknown")) {
    // Very low confidence on an unrecognised intent → ask a targeted question
    // instead of emitting a generic hedge (which users find unhelpful).
    finalText = buildClarifyingQuestion(workingText);
    trace.push({ stage: "confidence", detail: `very low confidence (${combined.toFixed(2)}) + unknown intent → clarifying question` });
  } else {
    finalText = hedge(stitched, combined);
    trace.push({ stage: "confidence", detail: `combined confidence=${combined.toFixed(2)}` });
  }

  lastTraceBySession.set(sessionId, trace);

  return {
    text: finalText,
    intent: primaryDetected?.intent ?? "unknown",
    confidence: combined,
    entities: primaryDetected?.entities ?? {},
    trace,
  };
}

export function formatTrace(trace: PipelineTraceStep[]): string {
  if (trace.length === 0) return "No reasoning trace available for the previous turn yet.";
  return `Here's how I arrived at that:\n\n${trace.map((t, i) => `${i + 1}. **${t.stage}** — ${t.detail}`).join("\n")}`;
}
