/**
 * Web intelligence: factual lookups via Wikipedia's public REST summary API.
 * This is plain internet access for facts — not a hosted AI/LLM API, and no
 * reasoning happens remotely; the fetched text is returned/cached verbatim
 * with a citation, and all reasoning about it still happens locally.
 */
import { stmts } from "../db/index.js";

const STALE_MS = 24 * 60 * 60 * 1000; // 24h
const ENDPOINT = "https://en.wikipedia.org/api/rest_v1/page/summary/";

export interface WebLookupResult {
  topic: string;
  content: string;
  sourceUrl: string | null;
  fromCache: boolean;
}

export async function lookupTopic(topic: string): Promise<WebLookupResult | null> {
  const key = topic.toLowerCase().trim();
  const cached = stmts.getWebCache.get(key) as { topic: string; content: string; source_url: string | null; fetched_at: string } | undefined;
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < STALE_MS) {
    return { topic: key, content: cached.content, sourceUrl: cached.source_url, fromCache: true };
  }

  try {
    const res = await fetch(ENDPOINT + encodeURIComponent(topic), { headers: { "User-Agent": "IntelligentAssistantCore/1.0" } });
    if (!res.ok) {
      if (cached) return { topic: key, content: cached.content, sourceUrl: cached.source_url, fromCache: true };
      return null;
    }
    const data = (await res.json()) as { extract?: string; content_urls?: { desktop?: { page?: string } } };
    if (!data.extract) return cached ? { topic: key, content: cached.content, sourceUrl: cached.source_url, fromCache: true } : null;
    const sourceUrl = data.content_urls?.desktop?.page ?? null;
    stmts.upsertWebCache.run(key, data.extract, sourceUrl);
    return { topic: key, content: data.extract, sourceUrl, fromCache: false };
  } catch {
    if (cached) return { topic: key, content: cached.content, sourceUrl: cached.source_url, fromCache: true };
    return null;
  }
}

export function formatWebResult(result: WebLookupResult): string {
  const cite = result.sourceUrl ? `\n\nSource: ${result.sourceUrl} (Wikipedia)` : "\n\nSource: Wikipedia";
  const freshness = result.fromCache ? " *(cached)*" : "";
  return `${result.content}${cite}${freshness}`;
}
