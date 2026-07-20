import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, pickModel } from "../ai-gateway.server";

const schema = z.object({
  project_id: z.string().uuid(),
  topic: z.string().min(2).max(500),
  word_count: z.number().int().optional(),
  region: z.string().max(100).optional().default(""),
  open_access: z.enum(["any", "prefer", "required"]).default("any"),
  impact: z.enum(["any", "high", "mid", "practitioner"]).default("any"),
});

interface J {
  name: string;
  scope: string;
  audience: string;
  requirements: string;
  open_access: string;
  notes: string;
}

export const generateJournals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase.from("projects").select("*").eq("id", data.project_id).single();
    if (error || !project) throw new Error("Project not found");
    const model = pickModel(project.mode);
    const system = `You are ScholarlyWrite AI. Suggest 6 candidate journals, conferences, or edited volumes matching the manuscript. Include a mix of reputable outlets. Return valid JSON: {"journals":[{"name":"","scope":"","audience":"","requirements":"","open_access":"","notes":""}]}. Do not fabricate impact factors. Always add a note that the user must verify current scope, indexing, and requirements on the venue's website.`;
    const prompt = `Discipline: ${project.discipline || "general"}. Document type: ${project.doc_type}. Topic/abstract: ${data.topic}. Approximate word count: ${data.word_count ?? "unspecified"}. Region preference: ${data.region || "any"}. Open access: ${data.open_access}. Impact level: ${data.impact}.`;
    const result = await chatJSON<{ journals: J[] }>({ model, system, prompt, temperature: 0.6 });
    const rows = (result.journals ?? []).slice(0, 10).map((j) => ({
      project_id: data.project_id,
      name: String(j.name ?? "").slice(0, 200),
      scope: String(j.scope ?? "").slice(0, 500),
      audience: String(j.audience ?? "").slice(0, 300),
      requirements: String(j.requirements ?? "").slice(0, 800),
      open_access: String(j.open_access ?? "").slice(0, 100),
      notes: String(j.notes ?? "").slice(0, 500),
    }));
    if (rows.length) await supabase.from("journal_suggestions").insert(rows);
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "journals", model });
    return { count: rows.length };
  });

export const togglePinJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), pinned: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("journal_suggestions")
      .update({ pinned: data.pinned })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteJournal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("journal_suggestions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
