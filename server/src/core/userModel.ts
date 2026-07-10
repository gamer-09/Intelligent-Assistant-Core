/**
 * Long-term user model: lightweight persistent profile per session
 * (preferences learned from "remember that my X is Y" style teaching,
 * a rough expertise estimate from vocabulary, and a style preference).
 * Not an LLM profile — just structured state read/written across turns.
 */
import { stmts, type UserProfileRow } from "../db/index.js";

export interface UserProfile {
  sessionId: string;
  preferences: Record<string, string>;
  expertise: "novice" | "intermediate" | "advanced" | "unknown";
  style: "concise" | "detailed" | "unknown";
}

function rowToProfile(row: UserProfileRow): UserProfile {
  let preferences: Record<string, string> = {};
  try { preferences = JSON.parse(row.preferences); } catch { /* ignore malformed */ }
  return {
    sessionId: row.session_id,
    preferences,
    expertise: row.expertise as UserProfile["expertise"],
    style: row.style as UserProfile["style"],
  };
}

export function getProfile(sessionId: string): UserProfile {
  const row = stmts.getUserProfile.get(sessionId) as UserProfileRow | undefined;
  if (!row) return { sessionId, preferences: {}, expertise: "unknown", style: "unknown" };
  return rowToProfile(row);
}

export function setPreference(sessionId: string, key: string, value: string): void {
  const profile = getProfile(sessionId);
  profile.preferences[key] = value;
  stmts.upsertUserProfile.run(sessionId, JSON.stringify(profile.preferences), profile.expertise, profile.style);
}

const ADVANCED_TERMS = ["algorithm", "recursion", "api", "encryption", "asymptotic", "compiler", "regex", "database", "kernel"];

/** Nudge the expertise estimate based on vocabulary observed in a message. */
export function observeMessage(sessionId: string, text: string): void {
  const lower = text.toLowerCase();
  const hitsAdvanced = ADVANCED_TERMS.some((t) => lower.includes(t));
  if (!hitsAdvanced) return;
  const profile = getProfile(sessionId);
  if (profile.expertise === "unknown" || profile.expertise === "novice") {
    profile.expertise = "intermediate";
    stmts.upsertUserProfile.run(sessionId, JSON.stringify(profile.preferences), profile.expertise, profile.style);
  }
}
