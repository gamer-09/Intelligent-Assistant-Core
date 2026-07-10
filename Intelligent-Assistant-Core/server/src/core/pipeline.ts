/**
 * Modular reasoning pipeline — the explicit orchestration layer the review
 * asked for, replacing "one big switch statement gets called directly from
 * the route handler". Stages:
 *
 *   1. context      — load recent turns + rolling summary
 *   2. planning      — split compound requests into ordered subtasks
 *   3. NLU           — regex intent detection, boosted by semantic (BM25)
 *                      matching when regex confidence is weak
 *   4. generation    — existing intent handlers (now including the new
 *                      KG / reasoning / web / document / code tools)
 *   5. reflection    — sanity/contradiction check against known corrections
 *   6. confidence    — combine signals, optionally hedge the final text
 *
 * Every stage's output is captured into a `trace` so "how did you get that
 * answer?" (explainable reasoning) can be answered on request.
 */
import { detectIntent, type DetectedIntent } from "../nlp/intent-detector.js";
import { generateResponse } from "../nlp/response-generator.js";
import { getContext, resolveReference, rememberTopic } from "./contextManager.js";
import { splitCompoundRequest, stitchAnswers, type SubtaskResult } from "./planner.js";
import { semanticMatch } from "./semantic.js";
import { reflect } from "./reflection.js";
import { combineConfidence, hedge } from "./confidence.js";
import { observeMessage } from "./userModel.js";
import { getActiveGoal, formatGoal } from "./goals.js";

export interface PipelineTraceStep { stage: string; detail: string; }

export interface PipelineResult {
  text: string;
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  trace: PipelineTraceStep[];
}

const lastTraceBySession = new Map<string, PipelineTraceStep[]>();

// Autonomous goal resumption (review §13/§16): previously an active goal
// just sat in the DB until the user happened to ask about it again — Yang
// never proactively resurfaced unfinished work. This nudges once per
// session the next time the user talks to it while a goal is still open,
// rather than requiring the user to remember and ask.
const nudgedForGoalThisSession = new Set<string>();

export function getLastTrace(sessionId: string): PipelineTraceStep[] {
  return lastTraceBySession.get(sessionId) ?? [];
}

// Below this, guessing produces noise more often than a useful answer —
// asking a clarifying question is more honest and more useful than a
// confident-sounding wrong guess (review: "does Yang know when it might be
// wrong? can it ask clarifying questions?").
const CLARIFY_THRESHOLD = 0.2;

async function runSingle(text: string, sessionId: string, trace: PipelineTraceStep[], contextSummary: string, tavilyApiKey?: string): Promise<{ detected: DetectedIntent; answer: string }> {
  const ref = resolveReference(sessionId, text);
  if (ref.resolved) {
    trace.push({ stage: "reference", detail: `bare follow-up "${text}" resolved to last topic "${ref.topic}"` });
    text = ref.text;
  }

  let detected = detectIntent(text);
  trace.push({ stage: "nlu", detail: `regex intent="${detected.intent}" confidence=${detected.confidence.toFixed(2)}` });

  // Boost/rescue with semantic (BM25) matching when regex confidence is weak —
  // this is what lets paraphrases route correctly without a hand-written pattern.
  // The rolling session summary is folded into the text handed to the
  // semantic matcher so short follow-ups ("what about the second one?")
  // can still be routed using earlier topic context, not just the bare turn.
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

  // "trace" is handled here rather than in response-generator.ts to avoid a
  // circular import (response-generator would need to import the pipeline
  // that imports it) and because it needs the *previous* turn's trace.
  let raw: string;
  if (detected.intent === "trace") {
    raw = formatTrace(lastTraceBySession.get(sessionId) ?? []);
  } else if (detected.confidence < CLARIFY_THRESHOLD && detected.intent !== "general_knowledge" && detected.intent !== "small_talk") {
    trace.push({ stage: "clarify", detail: `confidence ${detected.confidence.toFixed(2)} below ${CLARIFY_THRESHOLD} — asking instead of guessing` });
    raw = `I'm not confident I understood that (confidence ${(detected.confidence * 100).toFixed(0)}%). Could you rephrase, or tell me more specifically what you're trying to do? For example: a math expression, a fact to remember, or a question about something I might know.`;
  } else {
    raw = await generateResponse(text, detected, sessionId, tavilyApiKey);
  }
  trace.push({ stage: "generation", detail: `handler for intent="${detected.intent}" produced ${raw.length} chars` });

  const reflected = reflect(text, raw);
  if (reflected.flagged) trace.push({ stage: "reflection", detail: reflected.note ?? "flagged" });

  // Remember a concrete "topic" for reference resolution on the *next* turn —
  // prefer an explicit entity if one was extracted, otherwise fall back to
  // the raw text itself so "why?" / "continue" have something to latch onto.
  const topicCandidate = (detected.entities.factKey as string | undefined)
    ?? (detected.entities.targetText as string | undefined)
    ?? (detected.entities.topic as string | undefined)
    ?? (detected.intent !== "trace" && detected.confidence >= CLARIFY_THRESHOLD ? text : undefined);
  if (topicCandidate) rememberTopic(sessionId, topicCandidate);

  return { detected, answer: reflected.text };
}

export async function runPipeline(text: string, sessionId: string, tavilyApiKey?: string): Promise<PipelineResult> {
  const trace: PipelineTraceStep[] = [];
  const context = getContext(sessionId);
  trace.push({ stage: "context", detail: `${context.recent.length} recent turn(s) in window${context.summary ? "; older turns summarized" : ""}` });
  observeMessage(sessionId, text);

  let goalNudge = "";
  if (!nudgedForGoalThisSession.has(sessionId)) {
    const activeGoal = getActiveGoal(sessionId);
    if (activeGoal && activeGoal.status === "active" && !activeGoal.steps.every((s) => s.done)) {
      nudgedForGoalThisSession.add(sessionId);
      goalNudge = `\n\n---\n_By the way, you still have an unfinished goal:_\n${formatGoal(activeGoal)}`;
      trace.push({ stage: "autonomy", detail: `proactively resurfaced unfinished goal "${activeGoal.title}"` });
    }
  }

  const subtasks = splitCompoundRequest(text);
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
  const finalText = (subtasks.length > 1 ? stitched : hedge(stitched, combined)) + goalNudge;
  trace.push({ stage: "confidence", detail: `combined confidence=${combined.toFixed(2)}` });

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
