import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, pickModel } from "../ai-gateway.server";

const visualSchema = z.object({
  project_id: z.string().uuid(),
  section_id: z.string().uuid().optional(),
  kind: z.enum(["table", "chart", "concept", "timeline", "figure"]),
  source: z.string().max(8000).optional().default(""),
  prompt: z.string().max(1000).optional().default(""),
});

export interface GeneratedVisual {
  kind: "table" | "chart" | "concept" | "timeline" | "figure";
  title: string;
  caption: string;
  markdown: string;
  columns: string[];
  rows: string[][];
  chart: Array<{ label: string; value: number }>;
  bullets: string[];
}

export const generateVisual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => visualSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("title,discipline,doc_type,mode,citation_style")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");

    let sectionText = "";
    if (data.section_id) {
      const { data: section } = await supabase
        .from("sections")
        .select("title,outline,content")
        .eq("id", data.section_id)
        .single();
      if (section) {
        sectionText = `Section: ${section.title}\nOutline:\n${section.outline ?? ""}\nDraft:\n${section.content ?? ""}`;
      }
    }

    const source = (data.source || sectionText).slice(0, 7000);
    if (!source.trim() && !data.prompt.trim()) throw new Error("Add section text or a prompt before generating a visual.");

    const model = pickModel(project.mode);
    const system = `You create lean academic visuals from manuscript text. Return strict JSON with keys: kind, title, caption, markdown, columns, rows, chart, bullets. columns is an array of headings. rows is an array of string arrays. chart is up to 8 objects with label and numeric value. bullets is up to 8 short strings. Do not invent measured data; if the source has no numbers, use a conceptual table, timeline, framework, or figure summary instead.`;
    const prompt = `Project: ${project.title}. Discipline: ${project.discipline || "general"}. Document type: ${project.doc_type}. Visual type: ${data.kind}. User instruction: ${data.prompt || "Create the most useful academic visual for this section."}\n\nSource text:\n${source}`;
    const raw = await chatJSON<Partial<GeneratedVisual>>({ model, system, prompt, temperature: 0.35, maxOutputTokens: 1800 });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: `visual:${data.kind}`, model });

    const labelForKind = (kind: GeneratedVisual["kind"]) =>
      kind === "chart" ? "Chart" : kind === "concept" ? "Concept map" : kind === "timeline" ? "Timeline" : kind === "figure" ? "Figure" : "Table";

    const visual: GeneratedVisual = {
      kind: data.kind,
      title: String(raw.title ?? `${labelForKind(data.kind)} visual`).slice(0, 180),
      caption: String(raw.caption ?? "").slice(0, 700),
      markdown: String(raw.markdown ?? "").slice(0, 4000),
      columns: Array.isArray(raw.columns) ? raw.columns.slice(0, 6).map((v) => String(v).slice(0, 80)) : [],
      rows: Array.isArray(raw.rows)
        ? raw.rows.slice(0, 12).map((row) => (Array.isArray(row) ? row.slice(0, 6).map((v) => String(v).slice(0, 220)) : []))
        : [],
      chart: Array.isArray(raw.chart)
        ? raw.chart.slice(0, 8).map((p) => ({ label: String((p as any).label ?? "Item").slice(0, 60), value: Number((p as any).value) || 0 }))
        : [],
      bullets: Array.isArray(raw.bullets) ? raw.bullets.slice(0, 8).map((v) => String(v).slice(0, 240)) : [],
    };

    if (!visual.markdown) {
      const lines = [`**${visual.title}**`];
      if (visual.columns.length && visual.rows.length) {
        lines.push("", `| ${visual.columns.join(" | ")} |`, `| ${visual.columns.map(() => "---").join(" | ")} |`);
        for (const row of visual.rows) lines.push(`| ${visual.columns.map((_, i) => row[i] ?? "").join(" | ")} |`);
      } else if (visual.chart.length) {
        lines.push("", ...visual.chart.map((p) => `- ${p.label}: ${p.value}`));
      } else if (visual.bullets.length) {
        lines.push("", ...visual.bullets.map((b) => `- ${b}`));
      }
      if (visual.caption) lines.push("", `*Figure note.* ${visual.caption}`);
      visual.markdown = lines.join("\n");
    }
    return visual;
  });