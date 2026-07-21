import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatReferenceList, type Reference } from "./citations";
import type { CitationStyle } from "./doc-templates";

const schema = z.object({
  project_id: z.string().uuid(),
  format: z.enum(["md", "docx", "html"]),
  scope: z.enum(["full", "section"]).default("full"),
  section_id: z.string().uuid().optional(),
  draft: z.boolean().optional().default(false),
});

interface Section {
  id: string;
  title: string;
  content: string;
  order: number;
}

const DRAFT_NOTE = "DRAFT — not for distribution";

export const exportProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: project }, { data: allSections }, { data: refRows }] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", data.project_id).single(),
      context.supabase.from("sections").select("*").eq("project_id", data.project_id).order("order"),
      context.supabase.from("refs").select("*").eq("project_id", data.project_id),
    ]);
    if (!project) throw new Error("Project not found");
    const sections: Section[] =
      data.scope === "section" && data.section_id
        ? (allSections ?? []).filter((s: Section) => s.id === data.section_id)
        : (allSections ?? []);
    if (!sections.length) throw new Error("No sections to export");
    const refs = (refRows ?? []) as Reference[];
    const style = project.citation_style as CitationStyle;
    const b64utf8 = (s: string) =>
      typeof Buffer !== "undefined"
        ? Buffer.from(s, "utf8").toString("base64")
        : btoa(unescape(encodeURIComponent(s)));
    const filenameBase = slug(project.title) + (data.scope === "section" ? "-section" : "");

    if (data.format === "md") {
      const parts: string[] = [];
      if (data.draft) parts.push(`> ${DRAFT_NOTE}\n`);
      parts.push(`# ${project.title}\n`);
      for (const s of sections) {
        parts.push(`## ${s.title}\n\n${s.content || "_(empty)_"}\n`);
      }
      if (refs.length) parts.push(`## References\n\n${formatReferenceList(refs, style)}\n`);
      const md = parts.join("\n");
      return {
        filename: `${filenameBase}.md`,
        mime: "text/markdown",
        contentB64: b64utf8(md),
      };
    }

    if (data.format === "html") {
      const escape = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const paragraphs = (t: string) =>
        (t || "")
          .split(/\n\n+/)
          .filter(Boolean)
          .map((p) => `<p>${escape(p).replace(/\n/g, "<br/>")}</p>`)
          .join("\n");
      const refBlock = refs.length
        ? `<h2>References</h2>\n${formatReferenceList(refs, style)
            .split("\n\n")
            .map((r) => `<p class="ref">${escape(r)}</p>`)
            .join("\n")}`
        : "";
      const draftCss = data.draft
        ? `body::before{content:"DRAFT";position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:160px;color:rgba(200,0,0,0.08);pointer-events:none;z-index:9999;font-weight:700;letter-spacing:8px;}`
        : "";
      const draftFooter = data.draft ? `<div class="draft-note">${DRAFT_NOTE}</div>` : "";
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escape(project.title)}</title>
<style>
  @page { margin: 1in; }
  body { font-family: "Times New Roman", Georgia, serif; font-size: 12pt; line-height: 1.55; color:#111; max-width: 780px; margin: 0 auto; padding: 32px; }
  h1 { font-size: 22pt; margin: 0 0 6pt; }
  h2 { font-size: 15pt; margin: 22pt 0 8pt; border-bottom:1px solid #ddd; padding-bottom:4pt; }
  p { margin: 0 0 10pt; text-align: justify; }
  .meta { color:#666; font-size:10pt; margin-bottom:18pt; }
  .draft-note { position: fixed; bottom: 12pt; left: 0; right: 0; text-align:center; font-size: 10pt; color:#a00; }
  .ref { text-indent: -1.5em; padding-left: 1.5em; }
  ${draftCss}
  @media print { body { padding: 0; max-width: none; } }
</style></head><body>
<h1>${escape(project.title)}</h1>
<div class="meta">${escape(project.doc_type || "")} · ${escape(style)} · ${data.draft ? "Draft" : "Final"} version</div>
${sections.map((s) => `<h2>${escape(s.title)}</h2>\n${paragraphs(s.content) || "<p><em>(empty)</em></p>"}`).join("\n")}
${refBlock}
${draftFooter}
</body></html>`;
      return {
        filename: `${filenameBase}.html`,
        mime: "text/html",
        contentB64: b64utf8(html),
      };
    }

    // DOCX
    const docx = await import("docx");
    const children: any[] = [];
    if (data.draft) {
      children.push(
        new docx.Paragraph({
          children: [
            new docx.TextRun({ text: DRAFT_NOTE, bold: true, color: "AA0000" }),
          ],
          spacing: { after: 200 },
        }),
      );
    }
    children.push(
      new docx.Paragraph({
        text: project.title,
        heading: docx.HeadingLevel.TITLE,
      }),
    );
    for (const s of sections) {
      children.push(
        new docx.Paragraph({
          text: s.title,
          heading: docx.HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }),
      );
      const paragraphs = (s.content || "").split(/\n\n+/);
      for (const p of paragraphs) {
        children.push(
          new docx.Paragraph({
            children: [new docx.TextRun(p)],
            spacing: { after: 120 },
          }),
        );
      }
    }
    if (refs.length) {
      children.push(
        new docx.Paragraph({
          text: "References",
          heading: docx.HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        }),
      );
      for (const line of formatReferenceList(refs, style).split("\n\n")) {
        children.push(new docx.Paragraph({ children: [new docx.TextRun(line)], spacing: { after: 80 } }));
      }
    }

    const footers = data.draft
      ? {
          default: new docx.Footer({
            children: [
              new docx.Paragraph({
                alignment: docx.AlignmentType.CENTER,
                children: [
                  new docx.TextRun({ text: DRAFT_NOTE, color: "AA0000", size: 18 }),
                ],
              }),
            ],
          }),
        }
      : undefined;

    const doc = new docx.Document({
      styles: {
        default: { document: { run: { font: "Times New Roman", size: 24 } } },
      },
      sections: [{ properties: {}, headers: undefined as any, footers, children }],
    });
    const b = await docx.Packer.toBase64String(doc);
    return {
      filename: `${filenameBase}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentB64: b,
    };
  });

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
}
