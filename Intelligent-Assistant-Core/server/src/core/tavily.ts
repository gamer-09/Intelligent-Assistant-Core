/**
 * Optional internet lookup via the Tavily Search API. Unlike webIntel.ts
 * (which hits Wikipedia's public REST API with no key needed), this requires
 * a user-supplied Tavily API key — pasted client-side and forwarded per
 * request, never stored server-side. When no key is provided this module is
 * simply not used; the assistant falls back to its local/Wikipedia knowledge.
 */
const ENDPOINT = "https://api.tavily.com/search";

export interface TavilySearchResult {
  answer: string | null;
  results: { title: string; url: string; content: string }[];
}

export async function searchTavily(query: string, apiKey: string): Promise<TavilySearchResult | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: 4,
      }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error("Tavily rejected the API key as invalid.");
      throw new Error(`Tavily search failed (HTTP ${res.status}).`);
    }
    const data = (await res.json()) as {
      answer?: string;
      results?: { title: string; url: string; content: string }[];
    };
    return { answer: data.answer ?? null, results: data.results ?? [] };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Tavily")) throw err;
    throw new Error("Couldn't reach Tavily — check your connection and API key.");
  }
}

export function formatTavilyResult(topic: string, result: TavilySearchResult): string {
  const lines: string[] = [];
  if (result.answer) lines.push(result.answer);
  if (result.results.length > 0) {
    lines.push("");
    lines.push("Sources:");
    for (const r of result.results.slice(0, 3)) lines.push(`• [${r.title}](${r.url})`);
  }
  if (lines.length === 0) return `Tavily didn't return anything useful for **"${topic}"**.`;
  return lines.join("\n");
}
