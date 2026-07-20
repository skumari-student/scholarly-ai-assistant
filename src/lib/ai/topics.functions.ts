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
    if (rows.length) await supabase.from("topics").insert(rows);
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
