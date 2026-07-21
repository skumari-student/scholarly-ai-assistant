import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chat, pickModel } from "../ai-gateway.server";

const ACTIONS = [
  "outline",
  "draft",
  "expand",
  "condense",
  "academic",
  "coherence",
  "redundancy",
  "clarify_method",
  "clarify_framework",
  "plagiarism_check",
] as const;

const schema = z.object({
  section_id: z.string().uuid(),
  action: z.enum(ACTIONS),
  extra: z.string().max(2000).optional().default(""),
  intensive: z.boolean().optional().default(false),
});

async function logUsage(
  supabase: any,
  project_id: string,
  user_id: string,
  kind: string,
  model: string,
) {
  await supabase.from("ai_usage").insert({ project_id, user_id, kind, model });
}

const LIT_REVIEW_KEYS = new Set(["literature", "lit_review", "literature_review", "themes"]);

export const runWritingAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: section, error } = await supabase
      .from("sections")
      .select("*, projects(*)")
      .eq("id", data.section_id)
      .single();
    if (error || !section) throw new Error(error?.message ?? "Section not found");
    const project = (section as any).projects;
    const model = pickModel(project.mode);

    const isLitReview = LIT_REVIEW_KEYS.has(section.key);
    let refsBlock = "";
    let intensiveDirective = "";

    if (data.intensive && isLitReview) {
      const { data: refs } = await supabase
        .from("refs")
        .select("cite_key,authors,year,title,container")
        .eq("project_id", project.id)
        .order("created_at");
      if (refs && refs.length) {
        const compact = refs
          .slice(0, 40)
          .map(
            (r: any) =>
              `- [${r.cite_key}] ${r.authors}${r.year ? ` (${r.year})` : ""}. ${r.title}${r.container ? `. ${r.container}` : ""}`,
          )
          .join("\n");
        refsBlock = `\n\nReference library (use these cite keys only; do not invent references):\n${compact}`;
        intensiveDirective = ` Use INTENSIVE citation: weave 2-4 references from the reference library into every paragraph as synthesis (compare/contrast/build), not one-source summaries. Every claim needs an in-text citation in ${project.citation_style} style, derived from the listed cite keys (e.g. author-year for APA/Chicago, [n]-style for IEEE using the cite_key). Never fabricate a citation outside the library.`;
      }
    }

    const system = `You are ScholarlyWrite AI, an academic writing assistant. Style: ${project.language_level} academic English. Discipline: ${project.discipline || "general"}. Document: ${project.doc_type}. Section: ${section.title}. Citation style: ${project.citation_style}. Be concise, structured, and ethical. Do not fabricate citations or data; refer to sources generically when no reference is supplied. Output plain prose unless asked for a list.${intensiveDirective}`;

    const ctx = [
      project.context_notes ? `Project notes:\n${project.context_notes}` : "",
      section.outline ? `Current outline:\n${section.outline}` : "",
      section.content ? `Current draft:\n${section.content.slice(0, 6000)}` : "",
      data.extra ? `User instruction:\n${data.extra}` : "",
      refsBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    const prompts: Record<(typeof ACTIONS)[number], string> = {
      outline: `Produce a short outline (bullet points, 5-9 items) for the "${section.title}" section.\n\n${ctx}`,
      draft: `Write a first draft of the "${section.title}" section using the outline and notes below. ${project.mode === "low" ? "Keep it concise (300-500 words)." : "Aim for 600-900 words."}\n\n${ctx}`,
      expand: `Expand the current draft with additional depth and detail while preserving the argument.\n\n${ctx}`,
      condense: `Condense the current draft. Preserve every key point but reduce length by ~30-40%.\n\n${ctx}`,
      academic: `Rewrite the current draft in a stronger, more formal academic tone. Improve precision and remove colloquialisms.\n\n${ctx}`,
      coherence: `Improve the coherence and flow of the current draft. Add transitions and reorder if needed. Preserve content.\n\n${ctx}`,
      redundancy: `Identify and remove redundant statements or repeated ideas in the current draft. Return the revised draft.\n\n${ctx}`,
      clarify_method: `Clarify the methodology described. Add missing detail (design, sample, instruments, analysis) as prompts in [brackets] where the author must decide.\n\n${ctx}`,
      clarify_framework: `Clarify the theoretical framework. Name the theory, key constructs, and how they map to the study.\n\n${ctx}`,
      plagiarism_check: `Review the current draft and flag any sentences that read as boilerplate, closely paraphrased text, or unattributed claims that would need a citation. Return a bullet list of concerns and rewrite suggestions.\n\n${ctx}`,
    };

    const output = await chat({ model, system, prompt: prompts[data.action], temperature: 0.5 });
    await logUsage(supabase, project.id, userId, `writing:${data.action}${data.intensive ? ":intensive" : ""}`, model);
    return { output };
  });
