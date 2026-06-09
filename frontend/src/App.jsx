import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";

import TopBar from "./components/TopBar.jsx";
import Hero from "./components/Hero.jsx";
import SearchBar from "./components/SearchBar.jsx";
import ExampleChips from "./components/ExampleChips.jsx";
import LoadingState from "./components/LoadingState.jsx";
import SummaryPanel from "./components/SummaryPanel.jsx";
import ResultsGrid from "./components/ResultsGrid.jsx";
import RefineBar from "./components/RefineBar.jsx";
import CompareDrawer from "./components/CompareDrawer.jsx";
import ProfilePanel from "./components/ProfilePanel.jsx";
import TrackifyPanel from "./components/TrackifyPanel.jsx";
import { recommend, getHealth, getMe } from "./api.js";

const HISTORY_KEY = "lumen.history.v1";
const THEME_KEY = "lumen.theme.v1";
const MAX_HISTORY = 8;

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // ignore
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function ConfigWarning({ health }) {
  if (!health) return null;
  const missing = [];
  if (!health.llm_provider) missing.push("an LLM key (GROQ / OPENAI / GEMINI / ANTHROPIC)");
  if (!health.search_provider) missing.push("a search key (TAVILY or SERPAPI)");
  if (!missing.length) return null;
  return (
    <div className="card border-coral-400/50 bg-coral-400/10 p-4 sm:p-5 flex items-start gap-3 max-w-3xl">
      <AlertTriangle className="w-5 h-5 text-coral-600 mt-0.5 shrink-0" />
      <div className="text-sm text-ink-700">
        Backend is missing <strong>{missing.join(" and ")}</strong>. Add to{" "}
        <code className="font-mono text-coral-700">backend/.env</code> and restart.
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(loadTheme);
  const [health, setHealth] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const [history, setHistory] = useState(loadHistory);
  const [compare, setCompare] = useState([]); // array of recs
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [trackifyOpen, setTrackifyOpen] = useState(false);
  const [trackifyInitialProduct, setTrackifyInitialProduct] = useState(null);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => {});
    if (localStorage.getItem("lumen.auth.token")) {
      getMe()
        .then(setUser)
        .catch(() => localStorage.removeItem("lumen.auth.token"))
        .finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    if (authChecked && !user) {
      setProfileOpen(true);
      setDrawerOpen(false);
    }
  }, [authChecked, user]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const compareSet = useMemo(
    () => new Set(compare.map((c) => c.url)),
    [compare]
  );

  const pushHistory = (q) => {
    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, MAX_HISTORY);
      return next;
    });
  };

  const requireAuth = () => {
    if (user) return true;
    setProfileOpen(true);
    setError("Please login or signup to use LuMen - Smart Shopping Reader.");
    return false;
  };

  const runQuery = async (payload) => {
    if (!requireAuth()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setQuery(payload.query);
    try {
      const res = await recommend(payload);
      setData(res);
      pushHistory(payload.query);
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const onRefine = (instruction) => {
    if (!requireAuth()) return;
    if (!query) return;
    const refined = `${query}. Refine: ${instruction}`;
    runQuery({ query: refined, top_k: 6 });
  };

  const toggleCompare = (rec) => {
    if (!requireAuth()) return;
    setCompare((prev) => {
      const exists = prev.find((r) => r.url === rec.url);
      if (exists) return prev.filter((r) => r.url !== rec.url);
      return [...prev, rec].slice(0, 6);
    });
  };

  const clearCompare = () => setCompare([]);

  const openTrackify = (product = null) => {
    if (!requireAuth()) return;
    setTrackifyInitialProduct(product);
    setTrackifyOpen(true);
  };

  return (
    <div className="app-shell min-h-full">
      <TopBar
        providers={data?.providers || null}
        history={history}
        onPickHistory={(q) => {
          if (!requireAuth()) return;
          setQuery(q);
          runQuery({ query: q, top_k: 6 });
        }}
        compareCount={compare.length}
        onOpenCompare={() => {
          if (!requireAuth()) return;
          setDrawerOpen(true);
        }}
        onOpenTrackify={() => openTrackify(null)}
        trackifyCount={0}
        user={user}
        onOpenProfile={() => setProfileOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <Hero />

        <div className="mt-2">
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={runQuery}
            loading={loading}
            locked={authChecked && !user}
            onRequireAuth={requireAuth}
          />
          <ExampleChips
            disabled={loading}
            onPick={(q) => {
              if (!requireAuth()) return;
              setQuery(q);
              runQuery({ query: q, top_k: 6 });
            }}
          />
        </div>

        <main className="mt-12 pb-24">
          <ConfigWarning health={health} />

          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <LoadingState />
              </motion.div>
            )}

            {!loading && error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="card border-coral-400/50 bg-coral-400/10 p-5 max-w-3xl flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-coral-600 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-ink-800">
                    Couldn't fetch recommendations
                  </div>
                  <div className="text-sm text-ink-600 mt-1">{error}</div>
                </div>
              </motion.div>
            )}

            {!loading && data && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <SummaryPanel
                  query={data.query}
                  summary={data.summary}
                  intent={data.intent}
                />
                {data.results?.length ? (
                  <>
                    <ResultsGrid
                      results={data.results}
                      compareSet={compareSet}
                      onToggleCompare={toggleCompare}
                      onOpenTrackify={openTrackify}
                    />
                    <RefineBar onRefine={onRefine} disabled={loading} />
                  </>
                ) : (
                  <div className="card p-6 text-center text-ink-500 max-w-3xl">
                    No live results found. Try rephrasing or relaxing the constraints.
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="pb-12 border-t border-ink-200 pt-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink-400">
          <span className="font-display text-base text-ink-600">LuMen - Smart Shopping Reader</span>
          <span>Live web search · Real listings · Price tracking</span>
        </footer>
      </div>

      <CompareDrawer
        open={drawerOpen}
        items={compare}
        query={data?.query || query}
        health={health}
        onClose={() => setDrawerOpen(false)}
        onRemove={(it) => toggleCompare(it)}
        onClear={clearCompare}
      />
      <ProfilePanel
        open={profileOpen || (authChecked && !user)}
        user={user}
        onClose={() => {
          if (user) setProfileOpen(false);
        }}
        onAuth={(nextUser) => {
          setUser(nextUser);
          setError(null);
          setProfileOpen(false);
        }}
        onLogout={() => {
          setUser(null);
          setData(null);
          setCompare([]);
          setTrackifyOpen(false);
          setTrackifyInitialProduct(null);
          setProfileOpen(true);
        }}
      />
      <TrackifyPanel
        open={trackifyOpen}
        user={user}
        initialProduct={trackifyInitialProduct}
        onClose={() => setTrackifyOpen(false)}
      />
    </div>
  );
}
