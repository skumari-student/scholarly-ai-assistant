import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, pickModel } from "../ai-gateway.server";
import { parseCsv, parseXlsx, summarizeForPrompt, type ParsedDataset } from "../analysis.server";

export type ChartType = "bar" | "line" | "pie" | "scatter";

export interface RecommendedChart {
  title: string;
  type: ChartType;
  x: string;
  y: string;
  rationale: string;
  data: Array<{ label: string; value: number; series?: string }>;
}

export interface DatasetTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface AnalysisResult {
  summary: string;
  keyFindings: string[];
  recommendedCharts: RecommendedChart[];
  table: DatasetTable;
  citations: string[];
  source: { columns: string[]; rowCount: number };
}

const CHART_TYPES: ChartType[] = ["bar", "line", "pie", "scatter"];

function normalize(raw: any, source: ParsedDataset | null, refs: Array<{ authors: string | null; year: number | null; title: string | null }>): AnalysisResult {
  const findings = Array.isArray(raw?.keyFindings) ? raw.keyFindings.slice(0, 8).map((s: any) => String(s).slice(0, 320)) : [];
  const charts: RecommendedChart[] = Array.isArray(raw?.recommendedCharts)
    ? raw.recommendedCharts.slice(0, 4).map((c: any) => {
        const t = String(c?.type ?? "bar").toLowerCase();
        const type = (CHART_TYPES.includes(t as ChartType) ? t : "bar") as ChartType;
        const data = Array.isArray(c?.data)
          ? c.data.slice(0, 20).map((p: any) => ({
              label: String(p?.label ?? p?.x ?? "").slice(0, 60),
              value: Number(p?.value ?? p?.y) || 0,
              series: p?.series ? String(p.series).slice(0, 40) : undefined,
            }))
          : [];
        return {
          title: String(c?.title ?? "Chart").slice(0, 160),
          type,
          x: String(c?.x ?? "").slice(0, 60),
          y: String(c?.y ?? "").slice(0, 60),
          rationale: String(c?.rationale ?? "").slice(0, 320),
          data,
        };
      })
    : [];
  const table: DatasetTable = {
    title: String(raw?.table?.title ?? "Summary table").slice(0, 160),
    columns: Array.isArray(raw?.table?.columns) ? raw.table.columns.slice(0, 8).map((v: any) => String(v).slice(0, 60)) : source?.columns ?? [],
    rows: Array.isArray(raw?.table?.rows)
      ? raw.table.rows.slice(0, 20).map((r: any) => (Array.isArray(r) ? r.slice(0, 8).map((v: any) => String(v).slice(0, 220)) : []))
      : (source?.rows.slice(0, 20).map((r) => r.map((v) => String(v))) ?? []),
  };
  const citations = Array.isArray(raw?.citations)
    ? raw.citations.slice(0, 8).map((s: any) => String(s).slice(0, 220))
    : [];
  return {
    summary: String(raw?.summary ?? "").slice(0, 1400),
    keyFindings: findings,
    recommendedCharts: charts,
    table,
    citations,
    source: { columns: source?.columns ?? [], rowCount: source?.rowCount ?? 0 },
  };
}

function refsBlock(refs: Array<{ authors: string | null; year: number | null; title: string | null }>): string {
  if (!refs.length) return "No references in library.";
  return refs
    .slice(0, 20)
    .map((r, i) => `${i + 1}. ${r.authors ?? "Unknown"} (${r.year ?? "n.d."}). ${r.title ?? ""}`)
    .join("\n");
}

const datasetSchema = z.object({
  project_id: z.string().uuid(),
  section_id: z.string().uuid().optional(),
  upload_id: z.string().uuid().optional(),
  inline_csv: z.string().max(120000).optional(),
  prompt: z.string().max(800).optional().default(""),
});

export const analyzeDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => datasetSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("id,title,discipline,doc_type,mode,citation_style")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");

    let ds: ParsedDataset | null = null;
    if (data.inline_csv && data.inline_csv.trim()) {
      ds = parseCsv(data.inline_csv);
    } else if (data.upload_id) {
      const { data: up } = await (supabase as any)
        .from("uploads")
        .select("path,name,mime")
        .eq("id", data.upload_id)
        .single();
      if (!up?.path) throw new Error("Upload not found");
      const { data: file, error: dErr } = await supabase.storage.from("project-uploads").download(up.path);
      if (dErr || !file) throw new Error("Could not download data file");
      const isXlsx = /\.xlsx?$/i.test(up.name) || /spreadsheet|excel/i.test(up.mime ?? "");
      if (isXlsx) {
        ds = await parseXlsx(await file.arrayBuffer());
      } else {
        ds = parseCsv(await file.text());
      }
    } else {
      throw new Error("Provide a CSV/XLSX upload or pasted CSV.");
    }
    if (!ds.columns.length) throw new Error("Could not parse any columns from the data.");

    const { data: refRows } = await supabase
      .from("refs")
      .select("authors,year,title")
      .eq("project_id", data.project_id)
      .limit(20);

    const model = pickModel(project.mode);
    const system = `You are an academic data analyst. Given a small tabular dataset, return strict JSON with keys:
summary (string, 2-4 sentences),
keyFindings (array of 3-6 short strings),
recommendedCharts (array of 1-3 objects: title, type in {bar,line,pie,scatter}, x, y, rationale, data[] with {label,value,series?}),
table {title, columns[], rows[][]} (compact summary — aggregates or highlights, not the raw dataset),
citations (array of "Author (Year)" strings drawn ONLY from the library below when relevant).
Do not invent numbers; base every value on the dataset. Prefer summarised aggregates (means, totals, counts) in chart data.`;
    const prompt = `Project: ${project.title}. Discipline: ${project.discipline || "general"}. Document type: ${project.doc_type}.
User instruction: ${data.prompt || "Summarize the data and propose 2-3 visuals suitable for a Results/Discussion section."}

Reference library:
${refsBlock(refRows ?? [])}

Dataset:
${summarizeForPrompt(ds).slice(0, 6000)}`;

    const raw = await chatJSON<any>({ model, system, prompt, temperature: 0.2, maxOutputTokens: 2200 });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "analysis:data", model });
    return normalize(raw, ds, refRows ?? []);
  });

const textSchema = z.object({
  project_id: z.string().uuid(),
  section_id: z.string().uuid().optional(),
  prompt: z.string().max(800).optional().default(""),
});

export const analyzeSectionText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => textSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("id,title,discipline,doc_type,mode,citation_style")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");

    let sectionText = "";
    if (data.section_id) {
      const { data: sec } = await supabase
        .from("sections")
        .select("title,outline,content")
        .eq("id", data.section_id)
        .single();
      if (sec) sectionText = `Section: ${sec.title}\nOutline:\n${sec.outline ?? ""}\nDraft:\n${sec.content ?? ""}`;
    }
    if (!sectionText.trim()) throw new Error("Open a section with some text first.");

    const { data: refRows } = await supabase
      .from("refs")
      .select("authors,year,title")
      .eq("project_id", data.project_id)
      .limit(20);

    const model = pickModel(project.mode);
    const system = `You extract results and visuals from an academic section. Return strict JSON with keys:
summary, keyFindings[], recommendedCharts[] (title,type,x,y,rationale,data[{label,value,series?}]),
table {title,columns[],rows[][]}, citations[] (only from the library below).
Do not invent measured values. When you cannot extract numbers, propose a conceptual comparison table
and note "as reported by [Author, Year]" using the library.`;
    const prompt = `Project: ${project.title}. Discipline: ${project.discipline || "general"}.
User instruction: ${data.prompt || "Extract key findings and propose 1-2 visuals."}

Reference library:
${refsBlock(refRows ?? [])}

Source text (max 6k chars):
${sectionText.slice(0, 6000)}`;

    const raw = await chatJSON<any>({ model, system, prompt, temperature: 0.25, maxOutputTokens: 1800 });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "analysis:text", model });
    return normalize(raw, null, refRows ?? []);
  });
