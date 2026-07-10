import { useState, useEffect } from "react";
import { MessageSquare, BookOpen, Sparkles } from "lucide-react";
import ChatPage from "./pages/Chat";
import HelpPage from "./pages/Help";
import GeminiChatPage from "./pages/GeminiChat";
import SidebarSettings from "./components/SidebarSettings";

type Page = "chat" | "help" | "gemini";
type SystemStatus = "checking" | "online" | "offline";

const API = "/api";
const GEMINI_API_KEY_STORAGE_KEY = "iac_gemini_api_key";
const HEALTH_POLL_MS = 15000;

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [prefill, setPrefill] = useState("");
  const [systemStatus, setSystemStatus] = useState<SystemStatus>("checking");
  const [geminiReady, setGeminiReady] = useState(false);

  function navigateToChat(text: string) {
    setPrefill(text);
    setPage("chat");
  }

  // Real server health check, not a static label — polled so the badge
  // reflects the server actually being reachable right now.
  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch(`${API}/healthz`);
        if (!cancelled) setSystemStatus(res.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setSystemStatus("offline");
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Gemini is only actually "online" if there's a server-side key or a
  // user-supplied one saved in this browser.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/gemini/status`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const hasOwnKey = Boolean(localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY));
        setGeminiReady(Boolean(d.configured) || hasOwnKey);
      })
      .catch(() => {
        if (!cancelled) setGeminiReady(Boolean(localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)));
      });
    return () => { cancelled = true; };
  }, [page]);

  const statusLabel = systemStatus === "online" ? "SYSTEM ONLINE" : systemStatus === "offline" ? "SYSTEM OFFLINE" : "CHECKING…";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>I.A. CORE</h1>
          <p>Intelligent Assistant</p>
          <div className={`sidebar-online status-${systemStatus}`}>{statusLabel}</div>
        </div>
        <nav className="sidebar-nav">
          <button
            className={`nav-link ${page === "chat" ? "active" : ""}`}
            onClick={() => setPage("chat")}
          >
            <MessageSquare size={16} />
            Chat
          </button>
          <button
            className={`nav-link ${page === "help" ? "active" : ""}`}
            onClick={() => setPage("help")}
          >
            <BookOpen size={16} />
            Guide
          </button>
          <button
            className={`nav-link nav-link-gemini ${page === "gemini" ? "active" : ""}`}
            onClick={() => setPage("gemini")}
          >
            <Sparkles size={16} />
            Gemini
          </button>
        </nav>
        <SidebarSettings />

        <div className="sidebar-footer">
          {page === "gemini" ? (
            <>GEMINI TAB<br />{geminiReady ? "API key active — online" : "No API key — add one to go online"}</>
          ) : (
            <>LOCAL LOGIC<br />No external APIs</>
          )}
        </div>
      </aside>

      <main className="main">
        {page === "chat" && <ChatPage prefill={prefill} onPrefillUsed={() => setPrefill("")} />}
        {page === "help" && <HelpPage onExampleClick={navigateToChat} />}
        {page === "gemini" && <GeminiChatPage />}
      </main>
    </div>
  );
}
