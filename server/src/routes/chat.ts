import { Router } from "express";
import { db, stmts, type ConversationRow } from "../db/index.js";
import { detectIntent } from "../nlp/intent-detector.js";
import { generateResponse, clearSession } from "../nlp/response-generator.js";

const router = Router();

function rowToMessage(row: ConversationRow) {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    timestamp: row.created_at,
    intent: row.intent,
    confidence: row.confidence,
  };
}

// POST /api/chat/message
router.post("/message", (req, res) => {
  const { text, sessionId = "default" } = req.body as { text?: string; sessionId?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Message text is required." });
  }

  const trimmed = text.trim();
  const detected = detectIntent(trimmed);
  const responseText = generateResponse(trimmed, detected, sessionId);

  stmts.insertMessage.run(sessionId, "user", trimmed, detected.intent, detected.confidence);
  const userId = (stmts.lastInsertId.get() as { id: number }).id;

  stmts.insertMessage.run(sessionId, "assistant", responseText, detected.intent, detected.confidence);
  const asstId = (stmts.lastInsertId.get() as { id: number }).id;

  const userRow  = stmts.getById.get(userId)  as ConversationRow;
  const asstRow  = stmts.getById.get(asstId)  as ConversationRow;

  res.json({
    userMessage:      rowToMessage(userRow),
    assistantMessage: rowToMessage(asstRow),
    intent:     detected.intent,
    confidence: detected.confidence,
    entities:   detected.entities,
  });
});

// GET /api/chat/history
router.get("/history", (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  const rows = (
    limit
      ? stmts.getHistoryLimited.all(sessionId, limit)
      : stmts.getHistory.all(sessionId)
  ) as ConversationRow[];

  const total = (stmts.countBySession.get(sessionId) as { total: number }).total;

  res.json({ messages: rows.map(rowToMessage), sessionId, total });
});

// DELETE /api/chat/history
router.delete("/history", (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  stmts.deleteBySession.run(sessionId);
  clearSession(sessionId);
  res.json({ cleared: true, sessionId });
});

export default router;
