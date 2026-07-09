import { Router } from "express";
import { db, stmts } from "../db/index.js";
import { detectIntent } from "../nlp/intent-detector.js";
import { generateResponse, clearSession } from "../nlp/response-generator.js";

const router = Router();

// POST /api/chat/message
router.post("/message", (req, res) => {
  const { text, sessionId = "default" } = req.body as { text?: string; sessionId?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Message text is required." });
  }

  const trimmed = text.trim();
  const detected = detectIntent(trimmed);
  const responseText = generateResponse(trimmed, detected, sessionId);

  const now = new Date().toISOString();

  stmts.insertMessage.run({ sessionId, role: "user", text: trimmed, intent: detected.intent, confidence: detected.confidence });
  const userRow = db.prepare("SELECT * FROM conversations WHERE rowid = last_insert_rowid()").get() as { id: number; created_at: string };

  stmts.insertMessage.run({ sessionId, role: "assistant", text: responseText, intent: detected.intent, confidence: detected.confidence });
  const asstRow = db.prepare("SELECT * FROM conversations WHERE rowid = last_insert_rowid()").get() as { id: number; created_at: string };

  res.json({
    userMessage:      { id: userRow.id, role: "user",      text: trimmed,       timestamp: userRow.created_at, intent: detected.intent, confidence: detected.confidence },
    assistantMessage: { id: asstRow.id, role: "assistant", text: responseText,  timestamp: asstRow.created_at, intent: detected.intent, confidence: detected.confidence },
    intent: detected.intent,
    confidence: detected.confidence,
    entities: detected.entities,
  });
});

// GET /api/chat/history
router.get("/history", (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  const all = (limit ? stmts.getHistoryLimited.all({ sessionId, limit }) : stmts.getHistory.all({ sessionId })) as Array<{ id: number; role: string; text: string; intent: string | null; confidence: number | null; created_at: string }>;
  const total = (stmts.countBySession.get({ sessionId }) as { total: number }).total;

  res.json({
    messages: all.map(m => ({ id: m.id, role: m.role, text: m.text, timestamp: m.created_at, intent: m.intent, confidence: m.confidence })),
    sessionId,
    total,
  });
});

// DELETE /api/chat/history
router.delete("/history", (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  stmts.deleteBySession.run({ sessionId });
  clearSession(sessionId);
  res.json({ cleared: true, sessionId });
});

export default router;
