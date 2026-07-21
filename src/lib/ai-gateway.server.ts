// Server-only Lovable AI Gateway helper.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";

export interface ChatOptions {
  model?: string;
  system?: string;
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  prompt?: string;
  temperature?: number;
  json?: boolean;
  maxOutputTokens?: number;
}

export function createLovableAiGatewayRunIdFetch(initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  let resolveRunId: (value: string | undefined) => void = () => {};
  let runIdResolved = false;
  const runIdReady = new Promise<string | undefined>((resolve) => {
    resolveRunId = resolve;
  });

  const publishRunId = (value?: string) => {
    const nextRunId = value?.trim() || undefined;
    if (!runId && nextRunId) runId = nextRunId;
    if (!runIdResolved) {
      runIdResolved = true;
      resolveRunId(runId);
    }
  };
  if (runId) publishRunId(runId);

  return {
    fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      try {
        const response = await fetch(input, { ...init, headers });
        publishRunId(response.headers.get(LOVABLE_AIG_RUN_ID_HEADER) ?? undefined);
        return response;
      } catch (error) {
        publishRunId(undefined);
        throw error;
      }
    },
    getRunId: () => runId,
    waitForRunId: () => (runId ? Promise.resolve(runId) : runIdReady),
  };
}

export function createLovableAiGatewayProvider(lovableApiKey: string, initialRunId?: string) {
  const runIdFetch = createLovableAiGatewayRunIdFetch(initialRunId);
  const provider = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    fetch: runIdFetch.fetch,
  });

  return Object.assign(provider, {
    getRunId: runIdFetch.getRunId,
    waitForRunId: runIdFetch.waitForRunId,
  });
}

export async function chat(opts: ChatOptions): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not set");
  const model = opts.model ?? "google/gemini-3.5-flash";
  const gateway = createLovableAiGatewayProvider(key);
  try {
    const base = {
      model: gateway(model),
      system: opts.system,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
    };
    const result = opts.messages
      ? await generateText({ ...base, messages: opts.messages })
      : await generateText({ ...base, prompt: opts.prompt ?? "" });
    return result.text ?? "";
  } catch (error) {
    throw new Error(normalizeGatewayError(error));
  }
}

export async function chatJSON<T = unknown>(opts: ChatOptions): Promise<T> {
  const jsonInstruction = "Return ONLY a single valid JSON value (object or array). No prose, no reasoning, no Markdown fences, no ```json wrappers. Begin your response with { or [ and end with } or ].";
  const text = await chat({
    ...opts,
    system: opts.system ? `${opts.system}\n\n${jsonInstruction}` : jsonInstruction,
    prompt: opts.prompt ? `${opts.prompt}\n\n${jsonInstruction}` : opts.prompt,
  });
  const parsed = parseLooseJson<T>(text);
  if (parsed !== undefined) return parsed;
  throw new Error("AI response was not valid JSON");
}

// Robust JSON parser that tolerates markdown fences, Gemini "reasoning"
// prefixes, trailing prose, and single-quoted keys/values.
export function parseLooseJson<T = unknown>(raw: string): T | undefined {
  if (!raw) return undefined;
  let text = String(raw);
  // Strip common reasoning/thinking prefixes.
  text = text.replace(/^\s*(?:thinking|reasoning|analysis|thought)[:\s\-][\s\S]*?(?=[\[{])/i, "");
  // Strip ```json ... ``` or ``` ... ``` fences (keep inner content).
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  const attempts = [text, extractBalanced(text, "{", "}"), extractBalanced(text, "[", "]")];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try { return JSON.parse(candidate) as T; } catch { /* fall through */ }
    // Best-effort: convert smart quotes and trim trailing commas.
    const cleaned = candidate
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(cleaned) as T; } catch { /* try next */ }
  }
  return undefined;
}

function extractBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function pickModel(mode: string | undefined): string {
  return mode === "advanced" ? "google/gemini-3.1-pro-preview" : "google/gemini-3.5-flash";
}

function normalizeGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/402|credit|billing/i.test(message)) return "AI credits are exhausted. Add credits, then try again.";
  if (/429|rate/i.test(message)) return "AI is rate limited right now. Wait a moment and try again.";
  if (/LOVABLE_API_KEY/i.test(message)) return "AI is not configured for this project.";
  return message || "AI request failed";
}
