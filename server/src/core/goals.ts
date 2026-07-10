/**
 * Goal tracking: persistent multi-step objectives a user is working towards
 * ("help me plan a trip"), distinct from one-off reminders — goals have an
 * ordered step list with progress state.
 */
import { stmts, type GoalRow } from "../db/index.js";

export interface Goal {
  id: number;
  title: string;
  steps: { text: string; done: boolean }[];
  status: string;
}

function rowToGoal(row: GoalRow): Goal {
  let steps: { text: string; done: boolean }[] = [];
  try { steps = JSON.parse(row.steps); } catch { /* ignore malformed */ }
  return { id: row.id, title: row.title, steps, status: row.status };
}

export function startGoal(sessionId: string, title: string, stepTexts: string[]): Goal {
  const steps = stepTexts.map((text) => ({ text, done: false }));
  stmts.insertGoal.run(sessionId, title, JSON.stringify(steps));
  return getActiveGoal(sessionId)!;
}

export function getActiveGoal(sessionId: string): Goal | undefined {
  const row = stmts.activeGoal.get(sessionId) as GoalRow | undefined;
  return row ? rowToGoal(row) : undefined;
}

export function listGoals(sessionId: string): Goal[] {
  return (stmts.listGoals.all(sessionId) as unknown as GoalRow[]).map(rowToGoal);
}

export function completeStep(sessionId: string, stepIndex: number): Goal | undefined {
  const goal = getActiveGoal(sessionId);
  if (!goal || !goal.steps[stepIndex]) return goal;
  goal.steps[stepIndex].done = true;
  stmts.updateGoalSteps.run(JSON.stringify(goal.steps), goal.id);
  if (goal.steps.every((s) => s.done)) {
    stmts.updateGoalStatus.run("complete", goal.id);
    goal.status = "complete";
  }
  return goal;
}

export function abandonGoal(sessionId: string): Goal | undefined {
  const goal = getActiveGoal(sessionId);
  if (!goal) return undefined;
  stmts.updateGoalStatus.run("abandoned", goal.id);
  goal.status = "abandoned";
  return goal;
}

export function formatGoal(goal: Goal): string {
  const lines = goal.steps.map((s, i) => `${s.done ? "✅" : "⬜"} ${i + 1}. ${s.text}`);
  return `**Goal: ${goal.title}** (${goal.status})\n${lines.join("\n")}`;
}
