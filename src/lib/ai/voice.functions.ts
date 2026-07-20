import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chat, pickModel } from "../ai-gateway.server";

const schema = z.object({
  project_id: z.string().uuid(),
  section_id: z.string().uuid().optional(),
  command: z.string().min(1).max(4000),
});

export const runVoiceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");
    let section: { title: string; content: string } | null = null;
    if (data.section_id) {
      const { data: s } = await supabase
        .from("sections")
        .select("title,content")
        .eq("id", data.section_id)
        .single();
      section = s ?? null;
    }
    const model = pickModel(project.mode);
    const system = `You are ScholarlyWrite AI's voice assistant. Give focused, structured critique or answers. Discipline: ${project.discipline || "general"}. Document: ${project.doc_type}. Level: ${project.language_level}. Keep responses concise (200-400 words). When asked to critique, list strengths, weaknesses, and next steps.`;
    const ctx = section
      ? `Active section: ${section.title}\nContent excerpt:\n${section.content.slice(0, 5000)}`
      : `Project notes:\n${project.context_notes ?? ""}`;
    const output = await chat({
      model,
      system,
      prompt: `${ctx}\n\nUser command:\n${data.command}`,
      temperature: 0.4,
    });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "voice", model });
    return { output };
  });

const saveSchema = z.object({
  project_id: z.string().uuid(),
  section_id: z.string().uuid().optional(),
  text: z.string().min(1).max(20000),
  kind: z.enum(["dictation", "command"]).default("dictation"),
});

export const saveTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("voice_transcripts").insert({
      project_id: data.project_id,
      section_id: data.section_id ?? null,
      text: data.text,
      kind: data.kind,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
