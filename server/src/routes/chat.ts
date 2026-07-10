import { Router } from "express";
import { stmts, type ConversationRow } from "../db/index.js";
import { clearSession } from "../nlp/response-generator.js";
import { runPipeline } from "../core/pipeline.js";

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
router.post("/message", async (req, res) => {
  const { text, sessionId = "default", tavilyApiKey } = req.body as { text?: string; sessionId?: string; tavilyApiKey?: string };

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Message text is required." });
  }

  const trimmed = text.trim();

  try {
    const result = await runPipeline(trimmed, sessionId, typeof tavilyApiKey === "string" && tavilyApiKey.trim() ? tavilyApiKey.trim() : undefined);

    stmts.insertMessage.run(sessionId, "user", trimmed, result.intent, result.confidence);
    const userId = (stmts.lastInsertId.get() as { id: number }).id;

    stmts.insertMessage.run(sessionId, "assistant", result.text, result.intent, result.confidence);
    const asstId = (stmts.lastInsertId.get() as { id: number }).id;

    const userRow  = stmts.getById.get(userId)  as unknown as ConversationRow;
    const asstRow  = stmts.getById.get(asstId)  as unknown as ConversationRow;

    res.json({
      userMessage:      rowToMessage(userRow),
      assistantMessage: rowToMessage(asstRow),
      intent:     result.intent,
      confidence: result.confidence,
      entities:   result.entities,
      trace:      result.trace,
    });
  } catch (err) {
    console.error("[chat] pipeline failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Something went wrong processing that message. Please try again." });
  }
});

// GET /api/chat/history
router.get("/history", (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  const rows = (
    limit
      ? stmts.getHistoryLimited.all(sessionId, limit)
      : stmts.getHistory.all(sessionId)
  ) as unknown as ConversationRow[];

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
