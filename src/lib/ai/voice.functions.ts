import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chat, chatJSON, pickModel } from "../ai-gateway.server";

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

const extractSchema = z.object({
  project_id: z.string().uuid(),
  transcript: z.string().min(3).max(8000),
});

interface ExtractResult {
  topic: string;
  objectives: string[];
  research_questions: string[];
  methodology: string;
  keywords: string[];
  notes: string;
}

export const extractFromNarration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => extractSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("title,doc_type,discipline,mode")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");
    const model = pickModel(project.mode);
    const system = `You extract structured research details from a spoken narration. Return strict JSON with keys: topic (string), objectives (string[]), research_questions (string[]), methodology (string), keywords (string[]), notes (string). Empty strings/arrays where unclear. Do not invent details not implied by the narration.`;
    const prompt = `Project: ${project.title} (${project.doc_type}${project.discipline ? `, ${project.discipline}` : ""})\n\nNarration:\n${data.transcript}`;
    const result = await chatJSON<ExtractResult>({ model, system, prompt, temperature: 0.2 });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "voice_extract", model });
    return {
      topic: String(result.topic ?? "").slice(0, 500),
      objectives: (result.objectives ?? []).slice(0, 10).map((s) => String(s).slice(0, 300)),
      research_questions: (result.research_questions ?? []).slice(0, 10).map((s) => String(s).slice(0, 300)),
      methodology: String(result.methodology ?? "").slice(0, 2000),
      keywords: (result.keywords ?? []).slice(0, 20).map((s) => String(s).slice(0, 60)),
      notes: String(result.notes ?? "").slice(0, 2000),
    };
  });
