import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, pickModel } from "../ai-gateway.server";

const schema = z.object({
  project_id: z.string().uuid(),
  brief: z.string().min(3).max(2000),
});

interface TopicItem {
  title: string;
  description: string;
  research_questions: string;
  trend_note: string;
}

export const generateTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase.from("projects").select("*").eq("id", data.project_id).single();
    if (error || !project) throw new Error("Project not found");
    const model = pickModel(project.mode);
    const system = `You are ScholarlyWrite AI. Suggest 5 current, trend-aligned academic topics tailored to the user's discipline. Return valid JSON: {"topics":[{"title":"","description":"","research_questions":"","trend_note":""}]}`;
    const prompt = `Discipline: ${project.discipline || "general"}. Document type: ${project.doc_type}. User brief: ${data.brief}`;
    const result = await chatJSON<{ topics: TopicItem[] }>({ model, system, prompt, temperature: 0.7 });
    const rows = (result.topics ?? []).slice(0, 8).map((t) => ({
      project_id: data.project_id,
      title: String(t.title ?? "").slice(0, 200),
      description: String(t.description ?? "").slice(0, 1000),
      research_questions: String(t.research_questions ?? "").slice(0, 1000),
      trend_note: String(t.trend_note ?? "").slice(0, 500),
    }));
    if (!rows.length) throw new Error("AI returned no parseable topics. Try rephrasing your brief.");
    await supabase.from("topics").insert(rows);
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "topics", model });
    return { count: rows.length };
  });

export const togglePinTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), pinned: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("topics").update({ pinned: data.pinned }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("topics").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// --- Brainstorming ---

const brainstormSchema = z.object({
  project_id: z.string().uuid(),
  area: z.string().min(3).max(2000),
  keywords: z.string().max(500).optional().default(""),
});

interface BrainstormResult {
  ideas: string[];
  problems: string[];
  questions: string[];
}

export const brainstormIdeas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => brainstormSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("discipline,doc_type,mode")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");
    const model = pickModel(project.mode);
    const system = `You brainstorm academic research directions. Return strict JSON: {"ideas":[], "problems":[], "questions":[]} with 5-7 items in each array. Ideas are angles/directions; problems are specific researchable problems; questions are sharp, answerable research questions.`;
    const prompt = `Discipline: ${project.discipline || "general"}. Document type: ${project.doc_type}. Area: ${data.area}${data.keywords ? `\nKeywords: ${data.keywords}` : ""}`;
    const result = await chatJSON<BrainstormResult>({ model, system, prompt, temperature: 0.8 });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "brainstorm", model });
    const ideas = (result.ideas ?? []).slice(0, 12).map((s) => String(s).slice(0, 400));
    const problems = (result.problems ?? []).slice(0, 12).map((s) => String(s).slice(0, 400));
    const questions = (result.questions ?? []).slice(0, 12).map((s) => String(s).slice(0, 400));
    if (!ideas.length && !problems.length && !questions.length) throw new Error("AI returned no brainstorm results. Try adding more detail to your area.");
    return { ideas, problems, questions };
  });

// --- Topic extraction from text or narration ---

const extractSchema = z.object({
  project_id: z.string().uuid(),
  text: z.string().min(3).max(8000),
});

interface ExtractTopicResult {
  implicit_topic: string;
  better_statements: string[];
  subtopics: string[];
}

export const extractTopicFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => extractSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("discipline,doc_type,mode")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error("Project not found");
    const model = pickModel(project.mode);
    const system = `You infer the underlying research topic from a piece of writing or narration. Return strict JSON: {"implicit_topic":"", "better_statements":[], "subtopics":[]}. Provide 3-5 sharper topic statements and 4-8 subtopics/angles suitable for a literature review.`;
    const prompt = `Discipline: ${project.discipline || "general"}. Document type: ${project.doc_type}.\n\nText:\n${data.text.slice(0, 6000)}`;
    const result = await chatJSON<ExtractTopicResult>({ model, system, prompt, temperature: 0.4 });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "topic_extract", model });
    return {
      implicit_topic: String(result.implicit_topic ?? "").slice(0, 400),
      better_statements: (result.better_statements ?? []).slice(0, 8).map((s) => String(s).slice(0, 400)),
      subtopics: (result.subtopics ?? []).slice(0, 12).map((s) => String(s).slice(0, 300)),
    };
  });

// --- Insert selected items as topics ---

const insertSchema = z.object({
  project_id: z.string().uuid(),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        description: z.string().max(1000).optional().default(""),
        research_questions: z.string().max(1000).optional().default(""),
      }),
    )
    .min(1)
    .max(20),
});

export const insertTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => insertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const rows = data.items.map((t) => ({
      project_id: data.project_id,
      title: t.title,
      description: t.description ?? "",
      research_questions: t.research_questions ?? "",
      trend_note: "",
    }));
    const { error } = await context.supabase.from("topics").insert(rows);
    if (error) throw new Error(error.message);
    return { count: rows.length };
  });
