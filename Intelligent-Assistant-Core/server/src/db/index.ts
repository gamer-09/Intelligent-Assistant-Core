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
  CREATE INDEX IF NOT EXISTS idx_learned_facts_updated_at ON learned_facts(updated_at);

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

  -- Knowledge graph: nodes are entities/concepts, edges are typed relations
  -- between them (e.g. "python" --is_a--> "programming language").
  -- Seeded from the static dictionaries + learned facts, and traversed for
  -- multi-hop reasoning instead of flat dictionary lookups.
  CREATE TABLE IF NOT EXISTS kg_nodes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    kind       TEXT    NOT NULL DEFAULT 'concept',
    source     TEXT    NOT NULL DEFAULT 'builtin'
  );

  CREATE TABLE IF NOT EXISTS kg_edges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    from_node   INTEGER NOT NULL REFERENCES kg_nodes(id),
    relation    TEXT    NOT NULL,
    to_node     INTEGER REFERENCES kg_nodes(id),
    to_literal  TEXT,
    weight      REAL    NOT NULL DEFAULT 1.0,
    source      TEXT    NOT NULL DEFAULT 'builtin',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges(from_node, relation);
  CREATE INDEX IF NOT EXISTS idx_kg_edges_to_node ON kg_edges(to_node);
  CREATE INDEX IF NOT EXISTS idx_kg_edges_to_literal ON kg_edges(to_literal);
  CREATE INDEX IF NOT EXISTS idx_kg_nodes_kind ON kg_nodes(kind);

  -- Symbolic relation facts for multi-step reasoning, e.g. "john older_than sarah".
  CREATE TABLE IF NOT EXISTS relation_facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject    TEXT    NOT NULL,
    relation   TEXT    NOT NULL,
    object     TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(subject, relation, object)
  );
  CREATE INDEX IF NOT EXISTS idx_relation_facts_rel ON relation_facts(relation);
  CREATE INDEX IF NOT EXISTS idx_relation_facts_subject ON relation_facts(subject);
  CREATE INDEX IF NOT EXISTS idx_relation_facts_object ON relation_facts(object);

  -- Cached web lookups (Wikipedia summaries) so repeated queries don't
  -- re-fetch, and staleness can be detected.
  CREATE TABLE IF NOT EXISTS web_cache (
    topic       TEXT    PRIMARY KEY,
    content     TEXT    NOT NULL,
    source_url  TEXT,
    fetched_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Indexed document chunks (from user-provided text/markdown files),
  -- retrievable via the TF-IDF/BM25 engine in core/retrieval.ts.
  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_name    TEXT    NOT NULL,
    chunk_index INTEGER NOT NULL,
    content     TEXT    NOT NULL,
    added_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_documents_name ON documents(doc_name);

  -- Long-term user model: preferences/expertise/style learned over time.
  CREATE TABLE IF NOT EXISTS user_profile (
    session_id  TEXT    PRIMARY KEY,
    preferences TEXT    NOT NULL DEFAULT '{}',
    expertise   TEXT    NOT NULL DEFAULT 'unknown',
    style       TEXT    NOT NULL DEFAULT 'unknown',
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Goal tracking: a user's ongoing multi-step objectives.
  CREATE TABLE IF NOT EXISTS goals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    steps      TEXT    NOT NULL DEFAULT '[]',
    status     TEXT    NOT NULL DEFAULT 'active',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_goals_session ON goals(session_id, status);

  -- Rolling per-session context summary (extractive), so history doesn't
  -- need to grow unbounded to keep useful context.
  CREATE TABLE IF NOT EXISTS context_summaries (
    session_id  TEXT    PRIMARY KEY,
    summary     TEXT    NOT NULL DEFAULT '',
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  countGapsForTopic: db.prepare(`SELECT COUNT(*) AS n FROM research_gaps WHERE topic = ?`),
  resolveGapsForTopic: db.prepare(`
    UPDATE research_gaps SET resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE topic = ? AND resolved_at IS NULL
  `),

  // Knowledge graph
  upsertNode: db.prepare(`
    INSERT INTO kg_nodes (name, kind, source) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET kind = excluded.kind
  `),
  getNode: db.prepare(`SELECT * FROM kg_nodes WHERE name = ?`),
  insertEdge: db.prepare(`
    INSERT INTO kg_edges (from_node, relation, to_node, to_literal, weight, source) VALUES (?, ?, ?, ?, ?, ?)
  `),
  edgesFrom: db.prepare(`
    SELECT kg_edges.*, kg_nodes.name AS to_name FROM kg_edges
    LEFT JOIN kg_nodes ON kg_nodes.id = kg_edges.to_node
    WHERE from_node = ?
  `),
  edgesFromByRelation: db.prepare(`
    SELECT kg_edges.*, kg_nodes.name AS to_name FROM kg_edges
    LEFT JOIN kg_nodes ON kg_nodes.id = kg_edges.to_node
    WHERE from_node = ? AND relation = ?
  `),
  edgesTo: db.prepare(`
    SELECT kg_edges.*, kg_nodes.name AS from_name FROM kg_edges
    LEFT JOIN kg_nodes ON kg_nodes.id = kg_edges.from_node
    WHERE to_node = ? OR to_literal = ?
  `),

  // Symbolic relation facts (multi-step reasoning)
  insertRelationFact: db.prepare(`
    INSERT INTO relation_facts (subject, relation, object) VALUES (?, ?, ?)
    ON CONFLICT(subject, relation, object) DO NOTHING
  `),
  relationFactsByRelation: db.prepare(`SELECT * FROM relation_facts WHERE relation = ?`),
  allRelationFacts: db.prepare(`SELECT * FROM relation_facts`),

  // Web cache
  getWebCache: db.prepare(`SELECT * FROM web_cache WHERE topic = ?`),
  upsertWebCache: db.prepare(`
    INSERT INTO web_cache (topic, content, source_url) VALUES (?, ?, ?)
    ON CONFLICT(topic) DO UPDATE SET content = excluded.content, source_url = excluded.source_url,
      fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `),

  // Documents
  insertDocChunk: db.prepare(`INSERT INTO documents (doc_name, chunk_index, content) VALUES (?, ?, ?)`),
  deleteDoc: db.prepare(`DELETE FROM documents WHERE doc_name = ?`),
  allDocChunks: db.prepare(`SELECT * FROM documents ORDER BY doc_name, chunk_index`),
  listDocNames: db.prepare(`SELECT DISTINCT doc_name FROM documents`),

  // User model
  getUserProfile: db.prepare(`SELECT * FROM user_profile WHERE session_id = ?`),
  upsertUserProfile: db.prepare(`
    INSERT INTO user_profile (session_id, preferences, expertise, style) VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      preferences = excluded.preferences, expertise = excluded.expertise, style = excluded.style,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `),

  // Goals
  insertGoal: db.prepare(`INSERT INTO goals (session_id, title, steps) VALUES (?, ?, ?)`),
  listGoals: db.prepare(`SELECT * FROM goals WHERE session_id = ? ORDER BY created_at DESC`),
  activeGoal: db.prepare(`SELECT * FROM goals WHERE session_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`),
  updateGoalSteps: db.prepare(`UPDATE goals SET steps = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),
  updateGoalStatus: db.prepare(`UPDATE goals SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`),

  // Context summaries
  getContextSummary: db.prepare(`SELECT * FROM context_summaries WHERE session_id = ?`),
  upsertContextSummary: db.prepare(`
    INSERT INTO context_summaries (session_id, summary) VALUES (?, ?)
    ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `),
};

export interface LearnedFactRow { id: number; key: string; value: string; source: string; updated_at: string; }
export interface CorrectionRow { id: number; query_pattern: string; wrong_answer: string | null; correct_answer: string; times_applied: number; created_at: string; }
export interface ResearchGapRow { id: number; topic: string; asked_at: string; resolved_at: string | null; }

export interface KgNodeRow { id: number; name: string; kind: string; source: string; }
export interface KgEdgeRow { id: number; from_node: number; relation: string; to_node: number | null; to_literal: string | null; weight: number; source: string; created_at: string; to_name?: string | null; from_name?: string | null; }
export interface RelationFactRow { id: number; subject: string; relation: string; object: string; created_at: string; }
export interface WebCacheRow { topic: string; content: string; source_url: string | null; fetched_at: string; }
export interface DocumentRow { id: number; doc_name: string; chunk_index: number; content: string; added_at: string; }
export interface UserProfileRow { session_id: string; preferences: string; expertise: string; style: string; updated_at: string; }
export interface GoalRow { id: number; session_id: string; title: string; steps: string; status: string; created_at: string; updated_at: string; }
export interface ContextSummaryRow { session_id: string; summary: string; updated_at: string; }
