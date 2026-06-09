import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Bot, User, Loader2, ArrowUpRight, Search } from "lucide-react";
import { copilotChat } from "../api.js";

export default function CopilotPanel({ open, onClose, searchContext }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Reset chat when search context changes (new search)
  useEffect(() => {
    const products = searchContext?.products || [];
    if (searchContext?.query && products.length > 0) {
      // Build a product-oriented welcome naming the actual results
      const top = products.slice(0, 3);
      const lines = top
        .map((p, i) => `${i + 1}. **${p.title}**${p.price ? ` — ${p.price}` : ""}`)
        .join("\n");
      const more = products.length > 3 ? `\n…and ${products.length - 3} more.` : "";
      setMessages([
        {
          role: "assistant",
          content: `Here's what I found for **${searchContext.query}**:\n\n${lines}${more}\n\nAsk me anything about these — specs, comparisons, or alternatives.`,
          id: "welcome",
        },
      ]);
      setError(null);
    } else if (searchContext?.query) {
      setMessages([
        {
          role: "assistant",
          content: `I see you searched for **${searchContext.query}**, but no products came back. Tell me more about what you need and I'll help you find it.`,
          id: "welcome",
        },
      ]);
      setError(null);
    } else {
      setMessages([
        {
          role: "assistant",
          content: "Hi! I'm your LuMen shopping assistant. Tell me what you're looking for and I'll help you find the best options.",
          id: "welcome-empty",
        },
      ]);
    }
  }, [searchContext?.query]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);

    const userMsg = { role: "user", content: text, id: Date.now() };
    const nextMessages = [...messages.filter((m) => m.id !== "welcome" && m.id !== "welcome-empty"), userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      // Only send role+content to the API
      const apiMessages = nextMessages.map(({ role, content }) => ({ role, content }));
      const res = await copilotChat({ messages: apiMessages, context: searchContext || null });

      const assistantMsg = {
        role: "assistant",
        content: res.reply,
        id: Date.now() + 1,
        searchQuery: res.search_query,
        newProducts: res.new_products,
        action: res.action,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="copilot-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-ink-900/20 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            key="copilot-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 h-full z-50 w-full sm:w-[420px] flex flex-col shadow-2xl"
            style={{ background: "var(--color-paper-50, #f9fafb)" }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 border-b border-ink-200 shrink-0"
              style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))" }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
              >
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-ink-800">LuMen Copilot</div>
                <div className="text-[11px] text-ink-500 truncate">
                  {searchContext?.query ? `Context: "${searchContext.query}"` : "AI Shopping Assistant"}
                </div>
              </div>
              <button onClick={onClose} className="btn-ghost p-1.5" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}

              {loading && (
                <div className="flex gap-2 items-start">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
                  >
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="card px-3 py-2 flex items-center gap-2 text-sm text-ink-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Thinking…
                  </div>
                </div>
              )}

              {error && (
                <div className="text-xs text-coral-600 text-center px-2">{error}</div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Suggested starters (when no real messages yet) */}
            {messages.length <= 1 && searchContext?.products?.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
                {buildStarters(searchContext.products).map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-4 py-3 border-t border-ink-200 shrink-0 flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about battery life, gaming, price…"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-ink-200 bg-paper-50 px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow"
                style={{ maxHeight: 100 }}
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
                title="Send"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2 items-start ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
          isUser ? "bg-ink-200" : ""
        }`}
        style={!isUser ? { background: "linear-gradient(135deg, #6366f1, #8b5cf6)" } : {}}
      >
        {isUser ? <User className="w-3.5 h-3.5 text-ink-600" /> : <Bot className="w-3.5 h-3.5 text-white" />}
      </div>

      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "text-white rounded-tr-sm"
              : "card rounded-tl-sm text-ink-800"
          }`}
          style={isUser ? { background: "linear-gradient(135deg, #6366f1, #8b5cf6)" } : {}}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
        />

        {/* Show searched indicator */}
        {msg.action === "searched" && msg.searchQuery && (
          <div className="flex items-center gap-1 text-[10px] text-ink-400">
            <Search className="w-3 h-3" />
            Searched: {msg.searchQuery}
          </div>
        )}

        {/* New products found */}
        {msg.newProducts?.length > 0 && (
          <div className="w-full space-y-1.5 mt-1">
            {msg.newProducts.slice(0, 3).map((p, i) => (
              <a
                key={i}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 card px-3 py-2 text-xs hover:bg-ink-100 transition-colors group"
              >
                <span className="flex-1 text-ink-700 truncate">{p.title}</span>
                <ArrowUpRight className="w-3 h-3 text-ink-400 group-hover:text-indigo-500 shrink-0" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Short product name for chips: first 3-4 words of the title
function shortName(title) {
  if (!title) return "";
  return title.split(/\s+/).slice(0, 3).join(" ");
}

// Build suggestion chips from the actual products in context
function buildStarters(products) {
  const chips = [];
  if (products.length >= 2) {
    chips.push(`Compare ${shortName(products[0].title)} vs ${shortName(products[1].title)}`);
  }
  if (products[0]) {
    chips.push(`Tell me more about ${shortName(products[0].title)}`);
  }
  chips.push("Which is the best value?");
  return chips.slice(0, 3);
}

// Minimal markdown renderer: bold, inline code
function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code class='font-mono text-[11px] bg-ink-100 px-1 rounded'>$1</code>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}
