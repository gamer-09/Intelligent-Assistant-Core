/**
 * Thin wrapper around Google's public Generative Language REST API, using
 * the user's own GEMINI_API_KEY. This is intentionally isolated to its own
 * module/tab — Yang's core pipeline (core/pipeline.ts and everything it
 * calls) never imports this file and must stay fully local. This is the
 * ONLY place in the codebase that talks to an external AI provider.
 */
const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export interface GeminiTurn { role: "user" | "model"; text: string; }

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function askGemini(turns: GeminiTurn[], overrideApiKey?: string): Promise<{ text: string } | { error: string }> {
  const apiKey = overrideApiKey?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "No Gemini API key set. Paste your key in the box above, or set GEMINI_API_KEY in your secrets and restart the server." };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { maxOutputTokens: 2048 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 400 && /API key not valid/i.test(body)) {
        return { error: "Gemini rejected the API key as invalid. Double-check GEMINI_API_KEY." };
      }
      if (res.status === 429) {
        return { error: "Gemini rate-limited this request. Try again in a moment." };
      }
      return { error: `Gemini request failed (HTTP ${res.status}).` };
    }

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) return { error: "Gemini returned an empty response." };
    return { text };
  } catch (err) {
    return { error: `Couldn't reach Gemini: ${err instanceof Error ? err.message : String(err)}` };
  }
}
