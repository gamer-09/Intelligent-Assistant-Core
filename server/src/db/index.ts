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
};
