import { Router } from "express";
import { stmts, type ConversationRow } from "../db/index.js";
import { askGemini, isGeminiConfigured, type GeminiTurn } from "../core/geminiClient.js";

const router = Router();

// Keep Gemini sessions namespaced away from Yang's local sessions so a
// history lookup with the wrong prefix can never mix the two chat modes.
function namespaced(sessionId: unknown): string {
  const sid = typeof sessionId === "string" && sessionId.trim() ? sessionId : "default";
  return sid.startsWith("gemini:") ? sid : `gemini:${sid}`;
}

function rowToMessage(row: ConversationRow) {
  return { id: row.id, role: row.role, text: row.text, timestamp: row.created_at };
}

router.get("/status", (_req, res) => {
  res.json({ configured: isGeminiConfigured() });
});

router.post("/message", async (req, res) => {
  const { text, sessionId = "default" } = req.body as { text?: string; sessionId?: string };
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Message text is required." });
  }
  const sid = namespaced(sessionId);
  const trimmed = text.trim();

  try {
    const history = (stmts.getHistory.all(sid) as unknown as ConversationRow[]).map<GeminiTurn>((r) => ({
      role: r.role === "assistant" ? "model" : "user",
      text: r.text,
    }));
    const turns: GeminiTurn[] = [...history, { role: "user", text: trimmed }];

    const result = await askGemini(turns);
    const isError = "error" in result;
    const finalText = isError ? (result as { error: string }).error : (result as { text: string }).text;

    stmts.insertMessage.run(sid, "user", trimmed, "gemini", null);
    const userId = (stmts.lastInsertId.get() as { id: number }).id;
    stmts.insertMessage.run(sid, "assistant", finalText, isError ? "gemini_error" : "gemini", null);
    const asstId = (stmts.lastInsertId.get() as { id: number }).id;

    const userRow = stmts.getById.get(userId) as unknown as ConversationRow;
    const asstRow = stmts.getById.get(asstId) as unknown as ConversationRow;

    res.json({ userMessage: rowToMessage(userRow), assistantMessage: rowToMessage(asstRow), error: isError ? finalText : null });
  } catch (err) {
    console.error("[gemini] request failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Something went wrong talking to Gemini. Please try again." });
  }
});

router.get("/history", (req, res) => {
  const sessionId = namespaced((req.query.sessionId as string) || "default");
  const rows = stmts.getHistory.all(sessionId) as unknown as ConversationRow[];
  res.json({ messages: rows.map(rowToMessage), sessionId });
});

router.delete("/history", (req, res) => {
  const sessionId = namespaced((req.query.sessionId as string) || "default");
  stmts.deleteBySession.run(sessionId);
  res.json({ cleared: true, sessionId });
});

export default router;
