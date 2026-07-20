import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DOC_TYPES } from "./doc-templates";

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createSchema = z.object({
  title: z.string().min(1).max(200),
  doc_type: z.string().min(1),
  discipline: z.string().max(120).optional().default(""),
  citation_style: z.enum(["APA", "MLA", "Chicago", "IEEE"]),
  language_level: z.enum(["basic", "intermediate", "advanced"]),
  mode: z.enum(["low", "advanced"]).default("low"),
  context_notes: z.string().max(4000).optional().default(""),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const tmpl = DOC_TYPES[data.doc_type];
    if (!tmpl) throw new Error("Unknown document type");
    const { data: proj, error } = await context.supabase
      .from("projects")
      .insert({
        user_id: context.userId,
        title: data.title,
        doc_type: data.doc_type,
        discipline: data.discipline,
        citation_style: data.citation_style,
        language_level: data.language_level,
        mode: data.mode,
        context_notes: data.context_notes,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    const rows = tmpl.sections.map((s, i) => ({
      project_id: proj.id,
      key: s.key,
      title: s.title,
      order: i,
    }));
    const { error: sErr } = await context.supabase.from("sections").insert(rows);
    if (sErr) throw new Error(sErr.message);
    return proj;
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [proj, sections, refs, topics, journals, usage] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", data.id).single(),
      context.supabase.from("sections").select("*").eq("project_id", data.id).order("order"),
      context.supabase.from("refs").select("*").eq("project_id", data.id).order("created_at"),
      context.supabase.from("topics").select("*").eq("project_id", data.id).order("created_at", { ascending: false }),
      context.supabase
        .from("journal_suggestions")
        .select("*")
        .eq("project_id", data.id)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("ai_usage")
        .select("id")
        .eq("project_id", data.id),
    ]);
    if (proj.error) throw new Error(proj.error.message);
    return {
      project: proj.data,
      sections: sections.data ?? [],
      refs: refs.data ?? [],
      topics: topics.data ?? [],
      journals: journals.data ?? [],
      usage_count: usage.data?.length ?? 0,
    };
  });

export const updateSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        content: z.string().optional(),
        outline: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.content !== undefined) patch.content = data.content;
    if (data.outline !== undefined) patch.outline = data.outline;
    const { error } = await context.supabase.from("sections").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProjectMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), mode: z.enum(["low", "advanced"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").update({ mode: data.mode }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
