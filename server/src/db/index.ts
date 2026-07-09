import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "assistant.db");

export const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL DEFAULT 'default',
    role       TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    intent     TEXT,
    confidence REAL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
    VALUES (@sessionId, @role, @text, @intent, @confidence)
  `),

  getHistory: db.prepare(`
    SELECT * FROM conversations
    WHERE session_id = @sessionId
    ORDER BY created_at ASC
  `),

  getHistoryLimited: db.prepare(`
    SELECT * FROM (
      SELECT * FROM conversations
      WHERE session_id = @sessionId
      ORDER BY created_at DESC
      LIMIT @limit
    ) ORDER BY created_at ASC
  `),

  countBySession: db.prepare(`
    SELECT COUNT(*) as total FROM conversations WHERE session_id = @sessionId
  `),

  deleteBySession: db.prepare(`
    DELETE FROM conversations WHERE session_id = @sessionId
  `),

  getIntentStats: db.prepare(`
    SELECT intent, COUNT(*) as count
    FROM conversations
    WHERE session_id = @sessionId AND role = 'user' AND intent IS NOT NULL
    GROUP BY intent
    ORDER BY count DESC
  `),
};
