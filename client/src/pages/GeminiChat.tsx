import { useState, useEffect, useRef } from "react";
import { Send, Trash2, Sparkles } from "lucide-react";

const API = "/api";

function getGeminiSessionId(): string {
  const key = "iac_gemini_session_id";
  let id = localStorage.getItem(key);
  if (!id) { id = "gsession-" + Date.now(); localStorage.setItem(key, id); }
  return id;
}

const SESSION_ID = getGeminiSessionId();

interface GeminiMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

export default function GeminiChatPage() {
  const [messages, setMessages] = useState<GeminiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`${API}/gemini/status`).then(r => r.json()).then(d => setConfigured(Boolean(d.configured)));
    fetch(`${API}/gemini/history?sessionId=${SESSION_ID}`)
      .then(r => r.json())
      .then(d => setMessages(d.messages ?? []));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/gemini/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, sessionId: SESSION_ID }),
      });
      const data = await res.json();
      if (data.userMessage && data.assistantMessage) {
        setMessages(prev => [...prev, data.userMessage, data.assistantMessage]);
      } else {
        setMessages(prev => [...prev, {
          id: Date.now(), role: "user", text: trimmed, timestamp: new Date().toISOString(),
        }, {
          id: Date.now() + 1, role: "assistant",
          text: data.error || "Something went wrong talking to Gemini.",
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now(), role: "assistant",
        text: "Network error — is the server running?",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  async function clearHistory() {
    await fetch(`${API}/gemini/history?sessionId=${SESSION_ID}`, { method: "DELETE" });
    setMessages([]);
    setShowConfirm(false);
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <>
      <div className="stats-bar gemini-stats-bar">
        <span className="stat"><Sparkles size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />GEMINI TAB — ONLINE MODE</span>
        <span style={{ marginLeft: "auto" }}>
          SESS: <span className="stat-val" style={{ fontSize: 10 }}>{SESSION_ID.replace("gsession-", "")}</span>
        </span>
      </div>

      {configured === false && (
        <div className="gemini-banner">
          GEMINI_API_KEY is not set. Add it in Secrets and restart the server to enable this tab — until then messages will return an error.
        </div>
      )}

      <div className="chat-area">
        {messages.length === 0 && !loading ? (
          <div className="empty-state">
            <div className="empty-icon"><Sparkles size={28} /></div>
            <h2>Gemini Mode</h2>
            <p>This tab is powered by Google Gemini, using your own API key. Everything typed here is sent to Gemini — it's the one place in this app that leaves your machine.</p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-avatar">{msg.role === "user" ? "YOU" : "GEM"}</div>
                <div className="message-body">
                  <div className="message-bubble msg-text">{renderText(msg.text)}</div>
                  <div className="message-meta">
                    <span className="msg-time">{formatTime(msg.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="message assistant">
                <div className="message-avatar">GEM</div>
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

      <div className="input-bar">
        <div className="input-wrap">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Gemini anything... (Shift+Enter for newline)"
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

      {showConfirm && (
        <div className="dialog-overlay" onClick={() => setShowConfirm(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>Clear Gemini conversation?</h3>
            <p>This will permanently delete all messages in this Gemini session. This cannot be undone.</p>
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
