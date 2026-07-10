import { Router, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// ── Localhost-only guard ────────────────────────────────────────────────────
// /api/settings mutates ASSISTANT_FS_ROOT, a security-boundary setting.
// Only requests arriving from the loopback interface are allowed.
function localOnly(req: Request, res: Response, next: NextFunction): void {
  const ip = req.socket.remoteAddress ?? "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLocal) {
    res.status(403).json({ error: "Settings endpoint is only accessible from localhost." });
    return;
  }
  next();
}
router.use(localOnly);

// Resolve server/.env — one level above this file's compiled output (dist/routes/).
// During dev (ts-node / tsx) __dirname is src/routes/, so go up two levels to reach server/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const ENV_PATH = path.join(SERVER_ROOT, ".env");

/** Read server/.env and return a key→value map. Creates the file if missing. */
function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) {
    // Seed from .env.example if present, otherwise start empty.
    const examplePath = path.join(SERVER_ROOT, ".env.example");
    const seed = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf-8") : "";
    fs.writeFileSync(ENV_PATH, seed, "utf-8");
  }
  const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
  const map: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    map[key] = value;
  }
  return map;
}

/** Write a single key into server/.env, preserving comments and other keys.
 *
 *  Handles quoted values by stripping surrounding quotes when matching a key,
 *  and always writes the new value unquoted. Only updates the first occurrence
 *  of the key so that duplicate entries don't accumulate.
 */
function writeEnvKey(key: string, value: string): void {
  const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    // Preserve blank lines and comments exactly as-is.
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return line;
    const k = trimmed.slice(0, eqIdx).trim();
    if (k === key && !found) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, updated.join("\n"), "utf-8");
}

// GET /api/settings — return current assistant settings
router.get("/", (_req, res) => {
  const env = readEnvFile();
  // Also fall back to the live process env in case the .env file hasn't been
  // created yet (first run without a .env).
  const fsRoot = env["ASSISTANT_FS_ROOT"] ?? process.env.ASSISTANT_FS_ROOT ?? "";
  res.json({ fsRoot });
});

// POST /api/settings — update assistant settings
router.post("/", (req, res) => {
  const { fsRoot } = req.body as { fsRoot?: string };
  if (typeof fsRoot !== "string") {
    res.status(400).json({ error: "fsRoot must be a string" });
    return;
  }

  // Reject control characters (including newlines and carriage returns) to
  // prevent injecting extra keys into the .env file.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(fsRoot)) {
    res.status(400).json({ error: "fsRoot must not contain control characters or newlines." });
    return;
  }

  const trimmed = fsRoot.trim();
  writeEnvKey("ASSISTANT_FS_ROOT", trimmed);
  // Apply immediately to the running process so no restart is needed.
  if (trimmed) {
    process.env.ASSISTANT_FS_ROOT = trimmed;
  } else {
    delete process.env.ASSISTANT_FS_ROOT;
  }
  res.json({ ok: true, fsRoot: trimmed });
});

export default router;
