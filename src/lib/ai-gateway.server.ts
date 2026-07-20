// Server-only Lovable AI Gateway helper.
const BASE = "https://ai.gateway.lovable.dev/v1";

export interface ChatOptions {
  model?: string;
  system?: string;
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  prompt?: string;
  temperature?: number;
  json?: boolean;
}

export async function chat(opts: ChatOptions): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not set");
  const model = opts.model ?? "google/gemini-3.5-flash";
  const messages = opts.messages
    ? opts.messages
    : [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.prompt ?? "" },
      ];
  const body: Record<string, unknown> = { model, messages };
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function chatJSON<T = unknown>(opts: ChatOptions): Promise<T> {
  const text = await chat({ ...opts, json: true });
  try {
    return JSON.parse(text) as T;
  } catch {
    // try to extract first JSON block
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("AI response was not valid JSON");
  }
}

export function pickModel(mode: string | undefined): string {
  return mode === "advanced" ? "google/gemini-3.1-pro-preview" : "google/gemini-3.5-flash";
}
