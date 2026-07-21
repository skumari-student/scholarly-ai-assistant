import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chat, pickModel } from "../ai-gateway.server";
import {
  columnAt,
  correlationMatrix,
  describe,
  frequency,
  isNumericColumn,
  linreg,
  tTest,
  toNumericColumn,
  type Descriptive,
} from "../stats.server";

export type QuantMethod = "descriptive" | "correlation" | "ttest" | "regression" | "frequency";

export interface QuantResult {
  method: QuantMethod;
  title: string;
  narrative: string;
  stats: unknown;
  table: { columns: string[]; rows: (string | number)[][] };
  chart?: {
    type: "bar" | "line" | "scatter" | "heatmap";
    x?: string;
    y?: string;
    data: Array<{ label: string; value: number; series?: string; z?: number }>;
  };
  inputs: Record<string, unknown>;
  citations: string[];
}

const schema = z.object({
  project_id: z.string().uuid(),
  dataset_id: z.string().uuid(),
  method: z.enum(["descriptive", "correlation", "ttest", "regression", "frequency"]),
  columns: z.array(z.string()).optional().default([]),
  group_col: z.string().optional(),
  x_col: z.string().optional(),
  y_col: z.string().optional(),
});

async function loadDataset(supabase: any, id: string) {
  const { data, error } = await supabase.from("datasets").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Dataset not found");
  if (data.kind === "qual") throw new Error("This dataset is qualitative; use Codes & Themes.");
  return data as { columns: string[]; sample: (string | number)[][]; row_count: number; name: string };
}

async function narrate(model: string, method: QuantMethod, statsSnippet: string, refBlock: string): Promise<string> {
  const system = `You are an academic data analyst. Write 2-4 concise sentences interpreting the statistics for an academic Results/Discussion section. Do not invent numbers. Mention the specific values from the statistics. Where relevant, cite from the reference library using APA-style (Author, Year); use only entries provided.`;
  const prompt = `Method: ${method}\nStatistics:\n${statsSnippet}\n\nReference library:\n${refBlock}`;
  const text = await chat({ model, system, prompt, temperature: 0.2, maxOutputTokens: 380 });
  return text.trim();
}

function refsBlock(refs: Array<{ authors: string | null; year: number | null; title: string | null }>): string {
  if (!refs.length) return "No references in library.";
  return refs.slice(0, 15).map((r, i) => `${i + 1}. ${r.authors ?? "Unknown"} (${r.year ?? "n.d."}). ${r.title ?? ""}`).join("\n");
}

export const runQuantAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }): Promise<QuantResult> => {
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("mode,discipline").eq("id", data.project_id).single();
    const { data: refRows } = await supabase.from("refs").select("authors,year,title").eq("project_id", data.project_id).limit(15);
    const ds = await loadDataset(supabase, data.dataset_id);
    const model = pickModel(project?.mode);
    const cols = ds.columns;
    const rows = ds.sample;

    let result: QuantResult;
    if (data.method === "descriptive") {
      const targets = (data.columns.length ? data.columns : cols).filter((c) => cols.includes(c));
      const descs: Descriptive[] = targets.map((c) => describe(c, columnAt(rows, cols.indexOf(c))));
      const stats = descs;
      const table = {
        columns: ["Variable", "N", "Missing", "Mean", "SD", "Min", "Q1", "Median", "Q3", "Max"],
        rows: descs.map((d) => [d.column, d.n, d.missing, fmt(d.mean), fmt(d.sd), fmt(d.min), fmt(d.q1), fmt(d.median), fmt(d.q3), fmt(d.max)]),
      };
      const chart = {
        type: "bar" as const,
        x: "variable", y: "mean",
        data: descs.filter((d) => d.mean != null).map((d) => ({ label: d.column, value: Number((d.mean ?? 0).toFixed(2)) })),
      };
      const narrative = await narrate(model, "descriptive", JSON.stringify(descs), refsBlock(refRows ?? []));
      result = { method: "descriptive", title: `Descriptive statistics — ${ds.name}`, narrative, stats, table, chart, inputs: { columns: targets }, citations: [] };
    } else if (data.method === "correlation") {
      const { labels, matrix } = correlationMatrix(cols, rows);
      const table = { columns: ["", ...labels], rows: matrix.map((row, i) => [labels[i], ...row.map((v) => v.toFixed(2))]) };
      const chart = {
        type: "heatmap" as const,
        data: labels.flatMap((rL, i) => labels.map((cL, j) => ({ label: `${rL}×${cL}`, value: matrix[i][j], series: rL, z: matrix[i][j] }))),
      };
      const narrative = await narrate(model, "correlation", JSON.stringify({ labels, matrix }), refsBlock(refRows ?? []));
      result = { method: "correlation", title: `Correlation matrix — ${ds.name}`, narrative, stats: { labels, matrix }, table, chart, inputs: {}, citations: [] };
    } else if (data.method === "ttest") {
      const g = data.group_col; const y = data.y_col;
      if (!g || !y || !cols.includes(g) || !cols.includes(y)) throw new Error("Pick a grouping column and a numeric column");
      const gi = cols.indexOf(g), yi = cols.indexOf(y);
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const key = String(r[gi] ?? "");
        const val = Number(r[yi]);
        if (!Number.isFinite(val)) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(val);
      }
      const keys = [...groups.keys()].filter((k) => (groups.get(k) ?? []).length >= 2).slice(0, 2);
      if (keys.length < 2) throw new Error("Need two groups with at least 2 values each");
      const a = groups.get(keys[0])!, b = groups.get(keys[1])!;
      const stats = tTest(a, b);
      const table = {
        columns: ["Group", "N", "Mean"],
        rows: [[keys[0], stats.nA, +stats.meanA.toFixed(3)], [keys[1], stats.nB, +stats.meanB.toFixed(3)]] as (string | number)[][],
      };
      const chart = { type: "bar" as const, x: g, y, data: [{ label: keys[0], value: +stats.meanA.toFixed(3) }, { label: keys[1], value: +stats.meanB.toFixed(3) }] };
      const narrative = await narrate(model, "ttest", JSON.stringify({ groups: keys, ...stats }), refsBlock(refRows ?? []));
      result = { method: "ttest", title: `Group comparison (${y} by ${g})`, narrative, stats, table, chart, inputs: { group_col: g, y_col: y }, citations: [] };
    } else if (data.method === "regression") {
      const x = data.x_col; const y = data.y_col;
      if (!x || !y || !cols.includes(x) || !cols.includes(y)) throw new Error("Pick numeric X and Y columns");
      const xs = toNumericColumn(columnAt(rows, cols.indexOf(x)));
      const ys = toNumericColumn(columnAt(rows, cols.indexOf(y)));
      const n = Math.min(xs.length, ys.length);
      if (n < 3) throw new Error("Need at least 3 paired observations");
      const stats = linreg(xs.slice(0, n), ys.slice(0, n));
      const table = { columns: ["Slope", "Intercept", "R²", "N"], rows: [[stats.slope, stats.intercept, stats.r2, stats.n]] as (string | number)[][] };
      const chart = { type: "scatter" as const, x, y, data: xs.slice(0, n).map((xv, i) => ({ label: String(xv), value: ys[i] })) };
      const narrative = await narrate(model, "regression", JSON.stringify({ x, y, ...stats }), refsBlock(refRows ?? []));
      result = { method: "regression", title: `Simple regression (${y} ~ ${x})`, narrative, stats, table, chart, inputs: { x_col: x, y_col: y }, citations: [] };
    } else {
      // frequency
      const c = data.columns[0] ?? cols[0];
      if (!cols.includes(c)) throw new Error("Pick a column");
      const freqs = frequency(columnAt(rows, cols.indexOf(c)));
      const table = { columns: [c, "Count"], rows: freqs.map((f) => [f.label, f.count] as (string | number)[]) };
      const chart = { type: "bar" as const, x: c, y: "count", data: freqs.map((f) => ({ label: f.label, value: f.count })) };
      const narrative = await narrate(model, "frequency", JSON.stringify(freqs), refsBlock(refRows ?? []));
      result = { method: "frequency", title: `Frequencies — ${c}`, narrative, stats: freqs, table, chart, inputs: { column: c }, citations: [] };
    }

    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: `quant:${data.method}`, model });
    return result;
  });

function fmt(n: number | null): string {
  return n == null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(3);
}

// Helper for UI: return column names + which are numeric.
export const getDatasetColumnTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ dataset_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ds, error } = await (context.supabase as any).from("datasets").select("columns,sample").eq("id", data.dataset_id).single();
    if (error || !ds) throw new Error("Dataset not found");
    return (ds.columns as string[]).map((c: string, i: number) => ({
      name: c,
      numeric: isNumericColumn(columnAt(ds.sample as unknown[][], i)),
    }));
  });
