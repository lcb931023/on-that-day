// Optional LLM upgrade for narration, routed through OpenRouter (OpenAI-compatible
// chat API). If OPENROUTER_API_KEY is set the narrator can turn structured sim beats
// into prose and weave in the real history. Without a key everything still runs on
// the offline templates — the LLM is a layer on top of the sim, never a dependency.
//
// Reads OPENROUTER_API_KEY from the environment (see .env loading in cli.js).
// Model is configurable via VOYAGER_MODEL; default is a capable, inexpensive one.

// `process` doesn't exist in the browser (voyager/web/app.js imports this module
// directly, unbundled) — guard every access so this file works unmodified in both
// Node (cli.js/export.js) and the browser (where there's simply no key, so LLM
// narration silently stays unavailable and offline templates take over).
const env = (k) => (typeof process !== "undefined" && process.env ? process.env[k] : undefined);

// Default kept to a model broadly available on OpenRouter accounts; override with
// VOYAGER_MODEL (e.g. "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct").
const MODEL = env("VOYAGER_MODEL") || "openai/gpt-4o-mini";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export function llmAvailable() {
  return Boolean(env("OPENROUTER_API_KEY"));
}

// system + user strings -> assistant text. Throws if no key or on HTTP error.
export async function chat(system, user, { maxTokens = 1200, temperature = 0.9 } = {}) {
  const key = env("OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://github.com/lcb931023/on-that-day",
      "X-Title": "Voyager TTRPG",
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: maxTokens, temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}
