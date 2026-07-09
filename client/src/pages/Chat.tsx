import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Trash2 } from "lucide-react";

const API = "/api";

// Stable session ID persisted in localStorage
function getSessionId(): string {
  const key = "iac_session_id";
  let id = localStorage.getItem(key);
  if (!id) { id = "session-" + Date.now(); localStorage.setItem(key, id); }
  return id;
}

const SESSION_ID = getSessionId();

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  intent: string | null;
  confidence: number | null;
}

interface Stats {
  totalMessages: number;
  topIntent: string | null;
}

// Render **bold** markdown
function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

const STARTERS = [
  "What is 12 * 15?",
  "What time is it?",
  "Tell me a joke",
  "Convert 100°F to Celsius",
  "Is 97 prime?",
  "Capital of Japan",
  "Reverse 'hello world'",
  "Fibonacci 10",
];

export default function ChatPage({
  prefill,
  onPrefillUsed,
}: {
  prefill: string;
  onPrefillUsed: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats>({ totalMessages: 0, topIntent: null });
  const [showConfirm, setShowConfirm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history + stats on mount
  useEffect(() => {
    fetch(`${API}/chat/history?sessionId=${SESSION_ID}`)
      .then(r => r.json())
      .then(d => setMessages(d.messages ?? []));
    fetchStats();
  }, []);

  // Handle prefill from help page
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      onPrefillUsed();
      textareaRef.current?.focus();
    }
  }, [prefill, onPrefillUsed]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  function fetchStats() {
    fetch(`${API}/assistant/stats?sessionId=${SESSION_ID}`)
      .then(r => r.json())
      .then(d => setStats({ totalMessages: d.totalMessages, topIntent: d.topIntent }));
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, sessionId: SESSION_ID }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, data.userMessage, data.assistantMessage]);
      fetchStats();
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now(), role: "assistant",
        text: "Network error — is the server running?",
        timestamp: new Date().toISOString(),
        intent: null, confidence: null,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  async function clearHistory() {
    await fetch(`${API}/chat/history?sessionId=${SESSION_ID}`, { method: "DELETE" });
    setMessages([]);
    setStats({ totalMessages: 0, topIntent: null });
    setShowConfirm(false);
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <>
      {/* Stats bar */}
      <div className="stats-bar">
        <span className="stat">MSGS: <span className="stat-val">{stats.totalMessages}</span></span>
        {stats.topIntent && (
          <span className="stat">TOP: <span className="stat-val">{stats.topIntent.replace("_", " ").toUpperCase()}</span></span>
        )}
        <span style={{ marginLeft: "auto" }}>
          SESS: <span className="stat-val" style={{ fontSize: 10 }}>{SESSION_ID.replace("session-", "")}</span>
        </span>
      </div>

      {/* Messages */}
      <div className="chat-area">
        {messages.length === 0 && !loading ? (
          <div className="empty-state">
            <div className="empty-icon">&gt;_</div>
            <h2>System Online</h2>
            <p>I.A. CORE is ready. No external APIs — all processing is local. Input sequence required to begin.</p>
            <div className="starter-grid">
              {STARTERS.map(s => (
                <button key={s} className="starter-btn" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-avatar">{msg.role === "user" ? "YOU" : "IAC"}</div>
                <div className="message-body">
                  <div className="message-bubble msg-text">{renderText(msg.text)}</div>
                  <div className="message-meta">
                    <span className="msg-time">{formatTime(msg.timestamp)}</span>
                    {msg.role === "assistant" && msg.intent && msg.intent !== "unknown" && (
                      <span className="intent-badge">{msg.intent.replace("_", " ")}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="message assistant">
                <div className="message-avatar">IAC</div>
                <div className="message-body">
                  <div className="message-bubble">
                    <div className="typing"><span/><span/><span/></div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="input-bar">
        <div className="input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Enter command sequence... (Shift+Enter for newline)"
            rows={1}
            disabled={loading}
          />
          <div className="input-hint">
            <span>Enter to send · Shift+Enter for newline</span>
            {messages.length > 0 && (
              <button className="clear-btn" onClick={() => setShowConfirm(true)}>
                <Trash2 size={10} style={{ display: "inline", marginRight: 4 }} />
                Clear history
              </button>
            )}
          </div>
        </div>
        <button className="send-btn" onClick={() => send(input)} disabled={!input.trim() || loading}>
          <Send size={18} />
        </button>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="dialog-overlay" onClick={() => setShowConfirm(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>Clear conversation?</h3>
            <p>This will permanently delete all messages in this session. This cannot be undone.</p>
            <div className="dialog-actions">
              <button className="btn-cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="btn-danger" onClick={clearHistory}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
