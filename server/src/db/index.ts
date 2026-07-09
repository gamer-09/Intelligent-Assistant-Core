/**
 * Uses Node.js built-in SQLite (node:sqlite) — requires Node.js v22.5+.
 * No npm package, no native compilation, works on all platforms.
 */
import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "assistant.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL`);

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL DEFAULT 'default',
    role       TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    intent     TEXT,
    confidence REAL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_session
    ON conversations(session_id, created_at);

  -- Facts the assistant has been taught by users. These are checked
  -- before the built-in dictionaries, so a taught fact always wins.
  CREATE TABLE IF NOT EXISTS learned_facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL UNIQUE,
    value      TEXT    NOT NULL,
    source     TEXT    NOT NULL DEFAULT 'taught',
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Corrections: a normalized past query mapped to the answer a user
  -- corrected it to. Consulted before regenerating an answer, so a
  -- mistake is not repeated once it has been corrected.
  CREATE TABLE IF NOT EXISTS corrections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    query_pattern  TEXT    NOT NULL UNIQUE,
    wrong_answer   TEXT,
    correct_answer TEXT    NOT NULL,
    times_applied  INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Things the assistant did not know when asked (a "research gap").
  -- Once a matching learned_fact or correction is added, resolved_at is set.
  CREATE TABLE IF NOT EXISTS research_gaps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    topic       TEXT    NOT NULL,
    asked_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    resolved_at TEXT
  );
`);

export interface ConversationRow {
  id: number;
  session_id: string;
  role: string;
  text: string;
  intent: string | null;
  confidence: number | null;
  created_at: string;
}

export const stmts = {
  insertMessage: db.prepare(`
    INSERT INTO conversations (session_id, role, text, intent, confidence)
    VALUES (?, ?, ?, ?, ?)
  `),

  lastInsertId: db.prepare(`SELECT last_insert_rowid() AS id`),

  getById: db.prepare(`SELECT * FROM conversations WHERE id = ?`),

  getHistory: db.prepare(`
    SELECT * FROM conversations
    WHERE session_id = ?
    ORDER BY created_at ASC
  `),

  getHistoryLimited: db.prepare(`
    SELECT * FROM (
      SELECT * FROM conversations
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC
  `),

  countBySession: db.prepare(`
    SELECT COUNT(*) AS total FROM conversations WHERE session_id = ?
  `),

  deleteBySession: db.prepare(`
    DELETE FROM conversations WHERE session_id = ?
  `),

  getIntentStats: db.prepare(`
    SELECT intent, COUNT(*) AS count
    FROM conversations
    WHERE session_id = ? AND role = 'user' AND intent IS NOT NULL
    GROUP BY intent
    ORDER BY count DESC
  `),

  getLastUserMessage: db.prepare(`
    SELECT * FROM conversations
    WHERE session_id = ? AND role = 'user'
    ORDER BY created_at DESC
    LIMIT 1
  `),

  getLastAssistantMessage: db.prepare(`
    SELECT * FROM conversations
    WHERE session_id = ? AND role = 'assistant'
    ORDER BY created_at DESC
    LIMIT 1
  `),

  // Learned facts
  upsertFact: db.prepare(`
    INSERT INTO learned_facts (key, value, source) VALUES (?, ?, 'taught')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `),
  getFact: db.prepare(`SELECT * FROM learned_facts WHERE key = ?`),
  listFacts: db.prepare(`SELECT * FROM learned_facts ORDER BY updated_at DESC`),
  deleteFact: db.prepare(`DELETE FROM learned_facts WHERE key = ?`),

  // Corrections
  upsertCorrection: db.prepare(`
    INSERT INTO corrections (query_pattern, wrong_answer, correct_answer) VALUES (?, ?, ?)
    ON CONFLICT(query_pattern) DO UPDATE SET
      wrong_answer = excluded.wrong_answer,
      correct_answer = excluded.correct_answer
  `),
  getCorrection: db.prepare(`SELECT * FROM corrections WHERE query_pattern = ?`),
  bumpCorrectionUse: db.prepare(`UPDATE corrections SET times_applied = times_applied + 1 WHERE query_pattern = ?`),
  listCorrections: db.prepare(`SELECT * FROM corrections ORDER BY created_at DESC`),

  // Research gaps (self-identified unknowns)
  insertResearchGap: db.prepare(`INSERT INTO research_gaps (topic) VALUES (?)`),
  listOpenGaps: db.prepare(`SELECT * FROM research_gaps WHERE resolved_at IS NULL ORDER BY asked_at DESC`),
  resolveGapsForTopic: db.prepare(`
    UPDATE research_gaps SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE topic = ? AND resolved_at IS NULL
  `),
};

export interface LearnedFactRow { id: number; key: string; value: string; source: string; updated_at: string; }
export interface CorrectionRow { id: number; query_pattern: string; wrong_answer: string | null; correct_answer: string; times_applied: number; created_at: string; }
export interface ResearchGapRow { id: number; topic: string; asked_at: string; resolved_at: string | null; }
