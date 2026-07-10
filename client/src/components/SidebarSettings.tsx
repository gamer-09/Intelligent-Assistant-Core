import { useState, useEffect, useCallback } from "react";
import { FolderOpen, GitCommit, RefreshCw, CheckCircle, XCircle, Edit2 } from "lucide-react";

const API = "/api";
const REPO = "gamer-09/Intelligent-Assistant-Core";
const GITHUB_COMMITS_URL = `https://api.github.com/repos/${REPO}/commits?per_page=1`;

interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SidebarSettings() {
  const [commit, setCommit] = useState<Commit | null>(null);
  const [commitError, setCommitError] = useState(false);
  const [commitLoading, setCommitLoading] = useState(true);

  const [fsRoot, setFsRoot] = useState("");
  const [fsRootInput, setFsRootInput] = useState("");
  const [editingFsRoot, setEditingFsRoot] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Fetch latest commit from GitHub (public API, no auth needed)
  const fetchCommit = useCallback(() => {
    setCommitLoading(true);
    setCommitError(false);
    fetch(GITHUB_COMMITS_URL)
      .then((r) => {
        if (!r.ok) throw new Error("GitHub API error");
        return r.json();
      })
      .then((data) => {
        const c = data[0];
        setCommit({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split("\n")[0],
          author: c.commit.author.name,
          date: c.commit.author.date,
        });
      })
      .catch(() => setCommitError(true))
      .finally(() => setCommitLoading(false));
  }, []);

  // Load current PC folder setting from server
  useEffect(() => {
    fetch(`${API}/settings`)
      .then((r) => r.json())
      .then((d) => setFsRoot(d.fsRoot ?? ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCommit();
  }, [fetchCommit]);

  function startEdit() {
    setFsRootInput(fsRoot);
    setEditingFsRoot(true);
    setSaveState("idle");
  }

  function cancelEdit() {
    setEditingFsRoot(false);
    setSaveState("idle");
  }

  async function saveFsRoot(overrideValue?: string) {
    const value = overrideValue !== undefined ? overrideValue : fsRootInput;
    setSaveState("saving");
    try {
      const res = await fetch(`${API}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fsRoot: value }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = await res.json();
      setFsRoot(d.fsRoot);
      setEditingFsRoot(false);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2500);
    }
  }

  return (
    <div className="sidebar-settings">

      {/* ── Latest commit ── */}
      <div className="sb-section-label">
        <GitCommit size={11} />
        LATEST COMMIT
        <button className="sb-refresh-btn" onClick={fetchCommit} title="Refresh">
          <RefreshCw size={10} className={commitLoading ? "spin" : ""} />
        </button>
      </div>
      <div className="sb-commit-box">
        {commitLoading ? (
          <span className="sb-muted">Fetching…</span>
        ) : commitError ? (
          <span className="sb-muted sb-error">GitHub unreachable</span>
        ) : commit ? (
          <>
            <span className="sb-sha">{commit.sha}</span>
            <span className="sb-commit-msg" title={commit.message}>{commit.message}</span>
            <span className="sb-muted">{timeAgo(commit.date)}</span>
          </>
        ) : null}
      </div>

      {/* ── PC folder access ── */}
      <div className="sb-section-label">
        <FolderOpen size={11} />
        PC FOLDER ACCESS
      </div>
      <div className="sb-fs-box">
        {editingFsRoot ? (
          <>
            <input
              className="sb-fs-input"
              value={fsRootInput}
              onChange={(e) => setFsRootInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveFsRoot();
                if (e.key === "Escape") cancelEdit();
              }}
              placeholder={"e.g. C:\\Users\\you\\Documents"}
              autoFocus
            />
            <div className="sb-fs-actions">
              <button
                className="sb-btn-save"
                onClick={saveFsRoot}
                disabled={saveState === "saving"}
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </button>
              <button className="sb-btn-cancel" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
            {saveState === "error" && (
              <span className="sb-muted sb-error">Failed to save</span>
            )}
          </>
        ) : (
          <div className="sb-fs-row">
            <span className={fsRoot ? "sb-fs-path" : "sb-muted"} title={fsRoot || undefined}>
              {fsRoot ? fsRoot : "Disabled"}
            </span>
            <button className="sb-edit-btn" onClick={startEdit} title="Edit folder">
              <Edit2 size={11} />
            </button>
          </div>
        )}
        {saveState === "saved" && (
          <span className="sb-saved">
            <CheckCircle size={11} /> Saved · takes effect now
          </span>
        )}
        {!editingFsRoot && (
          <span className="sb-muted sb-hint">
            {fsRoot
              ? "AI can read files in this folder"
              : "Set a folder to let the AI read local files"}
          </span>
        )}
        {!editingFsRoot && fsRoot && (
          <button
            className="sb-btn-clear"
            onClick={() => saveFsRoot("")}
          >
            <XCircle size={10} /> Disable
          </button>
        )}
      </div>

    </div>
  );
}
