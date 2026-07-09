import { Router } from "express";
import { stmts } from "../db/index.js";
import { CAPABILITIES, CATEGORIES } from "../nlp/capabilities.js";

const router = Router();

// GET /api/assistant/capabilities
router.get("/capabilities", (_req, res) => {
  res.json({ capabilities: CAPABILITIES, categories: CATEGORIES });
});

// GET /api/assistant/stats
router.get("/stats", (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const total = (stmts.countBySession.get(sessionId) as { total: number }).total;
  const intentRows = stmts.getIntentStats.all(sessionId) as Array<{ intent: string; count: number }>;

  const intentBreakdown: Record<string, number> = {};
  for (const row of intentRows) intentBreakdown[row.intent] = row.count;

  res.json({
    totalMessages:    total,
    userMessages:     Math.ceil(total / 2),
    assistantMessages: Math.floor(total / 2),
    intentBreakdown,
    sessionId,
    topIntent: intentRows[0]?.intent ?? null,
  });
});

export default router;
