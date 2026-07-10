import { useState } from "react";
import { MessageSquare, BookOpen, Sparkles } from "lucide-react";
import ChatPage from "./pages/Chat";
import HelpPage from "./pages/Help";
import GeminiChatPage from "./pages/GeminiChat";

type Page = "chat" | "help" | "gemini";

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [prefill, setPrefill] = useState("");

  function navigateToChat(text: string) {
    setPrefill(text);
    setPage("chat");
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>I.A. CORE</h1>
          <p>Intelligent Assistant</p>
          <div className="sidebar-online">SYSTEM ONLINE</div>
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
        <div className="sidebar-footer">
          {page === "gemini" ? (
            <>GEMINI TAB<br />Uses your API key — online</>
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
