import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatReferenceList, type Reference } from "./citations";
import type { CitationStyle } from "./doc-templates";

const schema = z.object({
  project_id: z.string().uuid(),
  format: z.enum(["md", "docx"]),
  section_ids: z.array(z.string().uuid()).optional(),
});

interface Section {
  id: string;
  title: string;
  content: string;
  order: number;
}

async function loadDoc(supabase: any, project_id: string, section_ids?: string[]) {
  const [{ data: project }, { data: sections }, { data: refs }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", project_id).single(),
    supabase.from("sections").select("*").eq("project_id", project_id).order("order"),
    supabase.from("refs").select("*").eq("project_id", project_id),
  ]);
  const filtered: Section[] = section_ids?.length
    ? (sections ?? []).filter((s: Section) => section_ids.includes(s.id))
    : sections ?? [];
  return { project, sections: filtered, refs: (refs ?? []) as Reference[] };
}

export const exportProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { project, sections, refs } = await loadDoc(context.supabase, data.project_id, data.section_ids);
    const style = project.citation_style as CitationStyle;

    if (data.format === "md") {
      const md = [
        `# ${project.title}\n`,
        ...sections.map((s) => `## ${s.title}\n\n${s.content || "_(empty)_"}\n`),
        refs.length ? `## References\n\n${formatReferenceList(refs, style)}\n` : "",
      ].join("\n");
      return { filename: `${slug(project.title)}.md`, mime: "text/markdown", contentB64: b64(md) };
    }

    // DOCX
    const docx = await import("docx");
    const children: any[] = [
      new docx.Paragraph({
        text: project.title,
        heading: docx.HeadingLevel.TITLE,
      }),
    ];
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
    const doc = new docx.Document({
      styles: {
        default: { document: { run: { font: "Times New Roman", size: 24 } } },
      },
      sections: [{ properties: {}, children }],
    });
    const buf = await docx.Packer.toBuffer(doc);
    const b = Buffer.from(buf).toString("base64");
    return {
      filename: `${slug(project.title)}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentB64: b,
    };
  });

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
}

function b64(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(s)));
}
