import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const attachSchema = z.object({
  project_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
  kind: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  caption: z.string().max(1000).optional().default(""),
  payload: z.any(),
});

export interface AttachedVisual {
  id: string;
  project_id: string;
  section_id: string | null;
  kind: string;
  title: string;
  caption: string | null;
  payload: any;
  order: number;
  created_at: string;
}

export const listVisuals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("project_visuals")
      .select("*")
      .eq("project_id", data.project_id)
      .order("order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as AttachedVisual[];
  });

export const attachVisual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => attachSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      project_id: data.project_id,
      section_id: data.section_id ?? null,
      user_id: context.userId,
      kind: data.kind,
      title: data.title,
      caption: data.caption ?? "",
      payload: data.payload ?? {},
    };
    const { data: inserted, error } = await (context.supabase as any)
      .from("project_visuals")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted as AttachedVisual;
  });

export const deleteVisual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("project_visuals")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
