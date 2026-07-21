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
  const jsonInstruction = "Return only valid JSON. Do not wrap it in Markdown.";
  const text = await chat({
    ...opts,
    system: opts.system ? `${opts.system}\n\n${jsonInstruction}` : jsonInstruction,
    prompt: opts.prompt ? `${opts.prompt}\n\n${jsonInstruction}` : opts.prompt,
  });
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

function normalizeGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/402|credit|billing/i.test(message)) return "AI credits are exhausted. Add credits, then try again.";
  if (/429|rate/i.test(message)) return "AI is rate limited right now. Wait a moment and try again.";
  if (/LOVABLE_API_KEY/i.test(message)) return "AI is not configured for this project.";
  return message || "AI request failed";
}
