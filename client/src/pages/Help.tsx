import { useState, useEffect } from "react";

const API = "/api";

interface Capability {
  id: string;
  name: string;
  description: string;
  examples: string[];
  category: string;
}

export default function HelpPage({ onExampleClick }: { onExampleClick: (text: string) => void }) {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/assistant/capabilities`)
      .then(r => r.json())
      .then(d => {
        setCapabilities(d.capabilities ?? []);
        setCategories(d.categories ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = capabilities.filter(c => {
    const matchesCat = activeCategory === "All" || c.category === activeCategory;
    const q = search.toLowerCase();
    const matchesSearch = !q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.examples.some(e => e.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  return (
    <div className="help-page">
      <div className="help-header">
        <h2>// CAPABILITY GUIDE</h2>
        <p>Everything I.A. CORE understands — {capabilities.length} capabilities across {categories.length} categories. Click any example to try it.</p>
      </div>

      <input
        className="search-box"
        placeholder="Search capabilities..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="category-tabs">
        {["All", ...categories].map(cat => (
          <button
            key={cat}
            className={`cat-tab ${activeCategory === cat ? "active" : ""}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="no-results">Loading capabilities...</div>
      ) : filtered.length === 0 ? (
        <div className="no-results">No capabilities match "{search}"</div>
      ) : (
        <div className="capabilities-grid">
          {filtered.map(cap => (
            <div key={cap.id} className="capability-card">
              <div className="cap-name">{cap.name}</div>
              <div className="cap-desc">{cap.description}</div>
              <div className="cap-examples">
                {cap.examples.map(ex => (
                  <button key={ex} className="example-chip" onClick={() => onExampleClick(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
