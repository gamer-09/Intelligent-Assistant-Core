/**
 * Read-only local system access. Lets the assistant look at (never modify)
 * a single directory the user explicitly opted into, plus basic, non-
 * sensitive machine stats. Disabled unless ASSISTANT_FS_ROOT is set.
 *
 * Safety model (mirrors docIntel.ts's DOCS_ROOT confinement):
 *  - Every path is resolved against ASSISTANT_FS_ROOT and rejected if it
 *    escapes that root (absolute paths, "..", symlink escape).
 *  - No write/delete/execute operations exist in this module at all.
 *  - File reads are capped in size and skip likely-sensitive files
 *    (dotfiles, credentials, keys) even inside the allowed root.
 */
import fs from "fs";
import path from "path";
import os from "os";

const MAX_LIST_ENTRIES = 200;
const MAX_READ_BYTES = 100_000; // 100 KB text cap

// Any dotfile (.env, .npmrc, .aws, .ssh, etc.) plus common key/credential
// name and extension patterns. Deliberately broad — this is a denylist on
// top of an already-confined, read-only root, not the only line of defense.
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\./, // dotfiles/dot-directories, e.g. .env, .ssh, .aws, .git
  /\.(pem|key|ppk|p12|pfx|pfxb|kdbx|ovpn|asc|gpg|jks|keystore)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /(credential|secret|password|passwd|token|apikey|api_key)/i,
];

function isSensitiveName(name: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(name));
}

function getRoot(): string | null {
  const configured = process.env.ASSISTANT_FS_ROOT?.trim();
  if (!configured) return null;
  return path.resolve(configured);
}

export function isSystemAccessEnabled(): boolean {
  return getRoot() !== null;
}

export function getConfiguredRoot(): string | null {
  return getRoot();
}

type ResolveResult = { ok: true; resolved: string; root: string } | { ok: false; error: string };

function withinRoot(candidate: string, root: string): boolean {
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate === root || candidate.startsWith(rootWithSep);
}

function resolveWithinRoot(userPath: string): ResolveResult {
  const root = getRoot();
  if (!root) {
    return {
      ok: false,
      error: "Local file access isn't enabled. Set ASSISTANT_FS_ROOT in server/.env to the one folder you want me to be able to look at, then restart the server.",
    };
  }
  if (!fs.existsSync(root)) {
    return { ok: false, error: `The configured folder does not exist: ${root}` };
  }
  // Canonicalize the root itself in case it's a symlink.
  const realRoot = fs.realpathSync(root);

  const cleaned = (userPath ?? "").trim() || ".";
  const resolved = path.resolve(root, cleaned);
  if (!withinRoot(resolved, root)) {
    return { ok: false, error: `For safety, I can only look inside ${root}. That path would go outside it.` };
  }

  // Lexical confinement above isn't enough on its own — a symlink *inside*
  // the root could point outside it. Resolve symlinks and re-check the
  // real path before allowing any stat/read/list to proceed.
  if (fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved);
    if (!withinRoot(realResolved, realRoot)) {
      return { ok: false, error: `For safety, I can only look inside ${root}. That path resolves (via a symlink) outside it.` };
    }
  }

  return { ok: true, resolved, root };
}

export interface DirEntry {
  name: string;
  type: "file" | "directory";
  sizeBytes?: number;
}

export function listDirectory(userPath: string): { entries: DirEntry[]; dir: string } | { error: string } {
  const r = resolveWithinRoot(userPath);
  if (!r.ok) return { error: r.error };
  if (!fs.existsSync(r.resolved)) return { error: `Not found: ${userPath || "(root)"}` };
  const stat = fs.statSync(r.resolved);
  if (!stat.isDirectory()) return { error: `Not a folder: ${userPath}. Did you mean to read it as a file?` };

  const names = fs.readdirSync(r.resolved)
    .filter((name) => !isSensitiveName(name)) // keep likely secrets out of listings too
    .slice(0, MAX_LIST_ENTRIES);
  const entries: DirEntry[] = names.map((name) => {
    const full = path.join(r.resolved, name);
    try {
      const s = fs.statSync(full);
      return s.isDirectory()
        ? { name, type: "directory" as const }
        : { name, type: "file" as const, sizeBytes: s.size };
    } catch {
      return { name, type: "file" as const };
    }
  });
  return { entries, dir: path.relative(r.root, r.resolved) || "." };
}

export function readTextFile(userPath: string): { content: string; file: string; truncated: boolean } | { error: string } {
  if (!userPath || !userPath.trim()) return { error: "Tell me which file to read, e.g. \"read the file notes.txt\"." };
  const r = resolveWithinRoot(userPath);
  if (!r.ok) return { error: r.error };
  if (!fs.existsSync(r.resolved)) return { error: `Not found: ${userPath}` };
  const stat = fs.statSync(r.resolved);
  // Check every path segment relative to root, not just the basename, so
  // e.g. ".ssh/config" is blocked even though "config" alone looks benign.
  const relSegments = path.relative(r.root, r.resolved).split(path.sep);
  if (!stat.isDirectory() && relSegments.some(isSensitiveName)) {
    return { error: "That file looks like it could hold credentials or keys, so I won't read it." };
  }
  if (stat.isDirectory()) return { error: `${userPath} is a folder, not a file. Try listing it instead.` };
  if (stat.size > MAX_READ_BYTES * 4) {
    return { error: `That file is too large to read (${Math.round(stat.size / 1024)} KB). I only read plain text files up to ~${MAX_READ_BYTES / 1000} KB.` };
  }
  const buf = fs.readFileSync(r.resolved);
  const truncated = buf.length > MAX_READ_BYTES;
  const content = buf.subarray(0, MAX_READ_BYTES).toString("utf-8");
  return { content, file: path.relative(r.root, r.resolved), truncated };
}

export interface SystemInfo {
  platform: string;
  arch: string;
  hostname: string;
  cpuModel: string;
  cpuCount: number;
  totalMemGB: number;
  freeMemGB: number;
  uptimeHours: number;
  nodeVersion: string;
}

/** Non-sensitive machine stats only — no usernames, paths, or network info. */
export function getSystemInfo(): SystemInfo {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    cpuCount: cpus.length,
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeMemGB: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    nodeVersion: process.version,
  };
}

export function formatSystemInfo(info: SystemInfo): string {
  return [
    `**System info**`,
    `- OS: ${info.platform} (${info.arch})`,
    `- CPU: ${info.cpuModel} × ${info.cpuCount}`,
    `- Memory: ${info.freeMemGB} GB free / ${info.totalMemGB} GB total`,
    `- Uptime: ${info.uptimeHours} hours`,
    `- Node: ${info.nodeVersion}`,
  ].join("\n");
}

export function formatDirListing(dir: string, entries: DirEntry[]): string {
  if (entries.length === 0) return `${dir} is empty.`;
  const lines = entries
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1))
    .map((e) => (e.type === "directory" ? `📁 ${e.name}/` : `📄 ${e.name}${e.sizeBytes != null ? ` (${e.sizeBytes} bytes)` : ""}`));
  return `**Contents of ${dir}:**\n\n${lines.join("\n")}`;
}
