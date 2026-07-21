import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, pickModel } from "../ai-gateway.server";

export interface QualCode {
  name: string;
  definition: string;
  evidence: Array<{ quote: string; source?: string }>;
}
export interface QualTheme { name: string; rationale: string; codes: string[] }
export interface QualResult {
  title: string;
  summary: string;
  codes: QualCode[];
  themes: QualTheme[];
  table: { columns: string[]; rows: string[][] };
  citations: string[];
  stats?: unknown;
}

const schema = z.object({
  project_id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  kind: z.enum(["codes_themes", "sentiment"]).default("codes_themes"),
  prompt: z.string().max(800).optional().default(""),
});

function refsBlock(refs: Array<{ authors: string | null; year: number | null; title: string | null }>): string {
  if (!refs.length) return "No references in library.";
  return refs.slice(0, 15).map((r, i) => `${i + 1}. ${r.authors ?? "Unknown"} (${r.year ?? "n.d."}). ${r.title ?? ""}`).join("\n");
}

export const runQualAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }): Promise<QualResult> => {
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("mode,discipline").eq("id", data.project_id).single();
    const { data: ds, error } = await (supabase as any).from("datasets").select("*").eq("id", data.dataset_id).single();
    if (error || !ds) throw new Error("Dataset not found");
    if (ds.kind === "quant") throw new Error("This dataset is quantitative; use Quantitative analysis.");
    const text = String(ds.text_content ?? "").slice(0, 12000);
    if (!text.trim()) throw new Error("Dataset has no text");
    const { data: refRows } = await supabase.from("refs").select("authors,year,title").eq("project_id", data.project_id).limit(15);
    const model = pickModel(project?.mode);

    const system = data.kind === "sentiment"
      ? `You analyse participant/interview text. Return strict JSON with keys: summary, codes[] (name, definition, evidence[{quote,source?}]) representing stances (positive/negative/mixed), themes[] (name, rationale, codes[] of code names), table {columns,rows[][]} showing stance × representative quote, citations[] drawn only from the library.`
      : `You perform inductive coding on qualitative text. Return strict JSON with keys: summary, codes[] (name, definition, evidence[{quote,source?}]) — 4 to 10 codes, themes[] (name, rationale, codes[]) — 2 to 4 themes, table {columns,rows[][]} summarising theme × representative quote, citations[] drawn only from the library. Use verbatim short quotes from the text; do not invent quotes.`;

    const prompt = `Instruction: ${data.prompt || "Extract codes and themes suitable for a qualitative Results section."}\n\nReference library:\n${refsBlock(refRows ?? [])}\n\nText:\n${text}`;

    const raw = await chatJSON<any>({ model, system, prompt, temperature: 0.2, maxOutputTokens: 2200 });

    const codes: QualCode[] = Array.isArray(raw?.codes) ? raw.codes.slice(0, 12).map((c: any) => ({
      name: String(c?.name ?? "").slice(0, 80),
      definition: String(c?.definition ?? "").slice(0, 320),
      evidence: Array.isArray(c?.evidence) ? c.evidence.slice(0, 4).map((e: any) => ({
        quote: String(e?.quote ?? "").slice(0, 320),
        source: e?.source ? String(e.source).slice(0, 80) : undefined,
      })) : [],
    })) : [];
    const themes: QualTheme[] = Array.isArray(raw?.themes) ? raw.themes.slice(0, 6).map((t: any) => ({
      name: String(t?.name ?? "").slice(0, 80),
      rationale: String(t?.rationale ?? "").slice(0, 320),
      codes: Array.isArray(t?.codes) ? t.codes.slice(0, 12).map((s: any) => String(s).slice(0, 80)) : [],
    })) : [];
    const table = {
      columns: Array.isArray(raw?.table?.columns) ? raw.table.columns.slice(0, 6).map((c: any) => String(c).slice(0, 60)) : ["Theme", "Representative quote"],
      rows: Array.isArray(raw?.table?.rows) ? raw.table.rows.slice(0, 20).map((r: any) =>
        Array.isArray(r) ? r.slice(0, 6).map((v: any) => String(v).slice(0, 320)) : []) : [],
    };
    const citations = Array.isArray(raw?.citations) ? raw.citations.slice(0, 8).map((s: any) => String(s).slice(0, 200)) : [];

    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: `qual:${data.kind}`, model });

    return {
      title: `${data.kind === "sentiment" ? "Sentiment/stance" : "Codes & themes"} — ${ds.name}`,
      summary: String(raw?.summary ?? "").slice(0, 1400),
      codes, themes, table, citations,
    };
  });
