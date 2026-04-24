import { useState, useRef, useEffect } from "react";
import "./App.css";

const API_URL = "http://localhost:3001/query";

interface Chunk {
  text: string;
  score: number;
  metadata: Record<string, string>;
}

interface Message {
  role: "user" | "assistant";
  question?: string;
  chunks?: Chunk[];
  error?: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages((prev) => [...prev, { role: "user", question }]);
    setLoading(true);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", chunks: data.chunks },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          error: err instanceof Error ? err.message : "Something went wrong.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="eyebrow">RAG Pipeline</span>
          <h1 className="site-title">Ask Your Doc</h1>
        </div>
        <div className="tech-badge">pgvector · OpenAI · Express</div>
      </header>

      <main className="feed">
        {messages.length === 0 && !loading && (
          <div className="empty">
            <p className="empty-label">No queries yet</p>
            <p className="empty-sub">
              Type a question below to search your document
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`entry entry--${msg.role}`}>
            {msg.role === "user" && (
              <div className="user-block">
                <span className="tag tag--you">YOU</span>
                <p className="user-question">{msg.question}</p>
              </div>
            )}

            {msg.role === "assistant" && msg.error && (
              <div className="error-block">
                <span className="tag tag--error">ERROR</span>
                <p>{msg.error}</p>
              </div>
            )}

            {msg.role === "assistant" && msg.chunks && (
              <div className="results-block">
                <div className="results-bar">
                  <span className="tag tag--result">RESULTS</span>
                  <span className="result-count">
                    {msg.chunks.length} passages found
                  </span>
                </div>
                {msg.chunks.map((chunk, j) => (
                  <div key={j} className="chunk">
                    <div className="chunk-top">
                      <span className="chunk-num">
                        {String(j + 1).padStart(2, "0")}
                      </span>
                      <span className="chunk-score">
                        {Math.round(chunk.score * 100)}% match
                      </span>
                      {chunk.metadata?.source && (
                        <span className="chunk-src">
                          {String(chunk.metadata.source)}
                        </span>
                      )}
                    </div>
                    <p className="chunk-text">{chunk.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="entry entry--assistant">
            <div className="searching">
              <span className="tag tag--result">SEARCHING</span>
              <div className="dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <div className="composer-row">
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder="Ask anything about your document..."
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          <button
            className="composer-btn"
            onClick={handleSubmit}
            disabled={!input.trim() || loading}
          >
            Send
          </button>
        </div>
        <p className="composer-hint">
          Enter to send · Shift+Enter for new line
        </p>
      </footer>
    </div>
  );
}

export default App;
