import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chat, chatJSON, pickModel } from "./ai-gateway.server";
import { formatReferenceList, type Reference } from "./citations";
import type { CitationStyle } from "./doc-templates";
import { countWords } from "./text";

export interface ChecklistItem { id: string; label: string; ok: boolean | null; note?: string }
export interface SubmissionRow {
  project_id: string;
  target_issn: string | null;
  target_title: string | null;
  cover_letter: string;
  checklist: ChecklistItem[];
  package: {
    funding?: string;
    conflicts?: string;
    data_availability?: string;
    contributions?: string;
    corresponding_author?: string;
  };
  status: "draft" | "ready" | "submitted";
  submitted_at: string | null;
}

const projId = z.object({ project_id: z.string().uuid() });

export const getSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => projId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any).from("submissions").select("*").eq("project_id", data.project_id).maybeSingle();
    return (row ?? null) as SubmissionRow | null;
  });

const upsertSchema = z.object({
  project_id: z.string().uuid(),
  target_issn: z.string().nullable().optional(),
  target_title: z.string().nullable().optional(),
  cover_letter: z.string().max(20000).optional(),
  checklist: z.array(z.any()).optional(),
  package: z.any().optional(),
  status: z.enum(["draft", "ready", "submitted"]).optional(),
});

export const upsertSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row: any = { ...data, user_id: context.userId };
    if (data.status === "submitted") row.submitted_at = new Date().toISOString();
    const { data: saved, error } = await (context.supabase as any)
      .from("submissions").upsert(row, { onConflict: "project_id" }).select().single();
    if (error) throw new Error(error.message);
    return saved as SubmissionRow;
  });

const genLetterSchema = z.object({ project_id: z.string().uuid(), issn: z.string().optional(), extra: z.string().max(400).optional() });
export const generateCoverLetter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => genLetterSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("*").eq("id", data.project_id).single();
    if (!project) throw new Error("Project not found");
    const { data: visuals } = await (supabase as any).from("project_visuals").select("title,payload").eq("project_id", data.project_id).limit(6);
    let journalLine = "the journal";
    if (data.issn) {
      const { data: j } = await (supabase as any).from("journal_cache").select("payload").eq("issn", `profile:${data.issn}`).maybeSingle();
      if (j?.payload?.title) journalLine = `${j.payload.title}${j.payload.publisher ? ` (${j.payload.publisher})` : ""}`;
    }
    const findings = (visuals ?? []).flatMap((v: any) => Array.isArray(v.payload?.keyFindings) ? v.payload.keyFindings : []).slice(0, 6);
    const model = pickModel(project.mode);
    const text = await chat({
      model,
      system: "You draft formal academic cover letters to journal editors. Return only the letter body in Markdown, no preamble. Keep it under 350 words.",
      prompt: `Draft a cover letter to the editor of ${journalLine} for the manuscript below.\n\nTitle: ${project.title}\nDoc type: ${project.doc_type}\nDiscipline: ${project.discipline ?? ""}\nAbstract: ${(project.abstract ?? "").slice(0, 1600)}\n\nKey findings:\n${findings.map((f: string) => `- ${f}`).join("\n") || "(derive from abstract)"}\n\nAdditional instructions: ${data.extra ?? ""}`,
      temperature: 0.4, maxOutputTokens: 900,
    });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "submission:cover", model });
    return { cover_letter: text.trim() };
  });

const checklistSchema = z.object({ project_id: z.string().uuid(), issn: z.string().optional() });
export const buildChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => checklistSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: project }, { data: sections }, { data: refs }, { data: visuals }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", data.project_id).single(),
      supabase.from("sections").select("title,content").eq("project_id", data.project_id),
      supabase.from("refs").select("id").eq("project_id", data.project_id),
      (supabase as any).from("project_visuals").select("id").eq("project_id", data.project_id),
    ]);
    if (!project) throw new Error("Project not found");
    const totalWords = (sections ?? []).reduce((s, x: any) => s + countWords(x.content ?? ""), 0);
    const abstractWords = countWords(project.abstract ?? "");
    const sectionTitles = (sections ?? []).map((s: any) => s.title.toLowerCase());
    const has = (kw: string) => sectionTitles.some((t: string) => t.includes(kw));
    const items: ChecklistItem[] = [
      { id: "abstract", label: "Abstract present", ok: !!(project.abstract ?? "").trim(), note: `${abstractWords} words` },
      { id: "abstract_len", label: "Abstract ≤ 300 words", ok: abstractWords > 0 && abstractWords <= 300, note: `${abstractWords} words` },
      { id: "wordcount", label: "Manuscript ≥ 1500 words", ok: totalWords >= 1500, note: `${totalWords} words total` },
      { id: "intro", label: "Introduction section", ok: has("intro") },
      { id: "methods", label: "Methods section", ok: has("method") },
      { id: "results", label: "Results section", ok: has("result") },
      { id: "discussion", label: "Discussion section", ok: has("discussion") },
      { id: "refs", label: "References present", ok: (refs?.length ?? 0) > 0, note: `${refs?.length ?? 0} references` },
      { id: "figures", label: "At least one visual/table attached", ok: (visuals?.length ?? 0) > 0 },
      { id: "style", label: `Citation style set (${project.citation_style})`, ok: !!project.citation_style },
    ];
    return items;
  });

export const verifyCitations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => projId.parse(d))
  .handler(async ({ data, context }) => {
    const { data: refs } = await context.supabase.from("refs").select("*").eq("project_id", data.project_id);
    const problems: Array<{ ref: string; issues: string[] }> = [];
    for (const r of (refs ?? []) as any[]) {
      const issues: string[] = [];
      if (!r.authors) issues.push("missing authors");
      if (!r.year) issues.push("missing year");
      if (!r.title) issues.push("missing title");
      if (!r.container && !r.publisher) issues.push("missing venue/publisher");
      if (!r.doi && !r.url) issues.push("missing DOI or URL");
      if (issues.length) problems.push({ ref: `${r.authors ?? "?"} — ${r.title ?? r.cite_key}`, issues });
    }
    return { total: refs?.length ?? 0, problems };
  });

// Export the submission package as a single combined DOCX (title page + cover letter + manuscript + refs).
const pkgSchema = z.object({ project_id: z.string().uuid() });
export const exportSubmissionPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pkgSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: project }, { data: sections }, { data: refs }, { data: sub }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", data.project_id).single(),
      supabase.from("sections").select("*").eq("project_id", data.project_id).order("order"),
      supabase.from("refs").select("*").eq("project_id", data.project_id),
      (supabase as any).from("submissions").select("*").eq("project_id", data.project_id).maybeSingle(),
    ]);
    if (!project) throw new Error("Project not found");
    const docx = await import("docx");
    const style = project.citation_style as CitationStyle;
    const pkg = (sub?.package ?? {}) as SubmissionRow["package"];
    const children: any[] = [];

    // Title page
    children.push(
      new docx.Paragraph({ text: project.title, heading: docx.HeadingLevel.TITLE, alignment: docx.AlignmentType.CENTER, spacing: { before: 2400, after: 400 } }),
      new docx.Paragraph({ text: project.doc_type ?? "", alignment: docx.AlignmentType.CENTER, spacing: { after: 800 } }),
    );
    if (pkg.corresponding_author) children.push(new docx.Paragraph({ text: `Corresponding author: ${pkg.corresponding_author}`, alignment: docx.AlignmentType.CENTER }));
    if (sub?.target_title) children.push(new docx.Paragraph({ text: `Submitted to: ${sub.target_title}`, alignment: docx.AlignmentType.CENTER, spacing: { after: 400 } }));
    children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));

    // Cover letter
    if (sub?.cover_letter) {
      children.push(new docx.Paragraph({ text: "Cover Letter", heading: docx.HeadingLevel.HEADING_1, spacing: { after: 120 } }));
      for (const p of sub.cover_letter.split(/\n\n+/)) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun(p)], spacing: { after: 120 } }));
      }
      children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }

    // Disclosures
    const dis = [
      ["Funding", pkg.funding],
      ["Conflicts of interest", pkg.conflicts],
      ["Data availability", pkg.data_availability],
      ["Author contributions", pkg.contributions],
    ].filter(([, v]) => (v ?? "").toString().trim().length);
    if (dis.length) {
      children.push(new docx.Paragraph({ text: "Author Disclosures", heading: docx.HeadingLevel.HEADING_1, spacing: { after: 120 } }));
      for (const [k, v] of dis) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `${k}: `, bold: true }), new docx.TextRun(String(v))], spacing: { after: 100 } }));
      }
      children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
    }

    // Manuscript
    children.push(new docx.Paragraph({ text: "Manuscript", heading: docx.HeadingLevel.HEADING_1, spacing: { after: 120 } }));
    for (const s of (sections ?? [])) {
      children.push(new docx.Paragraph({ text: s.title, heading: docx.HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
      for (const p of (s.content ?? "").split(/\n\n+/)) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun(p)], spacing: { after: 120 } }));
      }
    }

    // References
    if ((refs ?? []).length) {
      children.push(new docx.Paragraph({ text: "References", heading: docx.HeadingLevel.HEADING_1, spacing: { before: 200, after: 120 } }));
      for (const line of formatReferenceList(refs as Reference[], style).split("\n\n")) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun(line)], spacing: { after: 80 } }));
      }
    }

    const doc = new docx.Document({
      styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } },
      sections: [{ properties: {}, children }],
    });
    const contentB64 = await docx.Packer.toBase64String(doc);
    return {
      filename: `${slug(project.title)}-submission.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentB64,
    };
  });

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "submission";
}
