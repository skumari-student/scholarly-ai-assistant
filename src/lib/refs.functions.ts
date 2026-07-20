import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseBibTeX } from "./citations";

const addSchema = z.object({
  project_id: z.string().uuid(),
  cite_key: z.string().min(1).max(80),
  authors: z.string().min(1).max(500),
  year: z.number().int().nullable().optional(),
  title: z.string().min(1).max(500),
  container: z.string().max(300).nullable().optional(),
  publisher: z.string().max(300).nullable().optional(),
  doi: z.string().max(200).nullable().optional(),
  url: z.string().max(500).nullable().optional(),
});

export const addReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("refs").insert(data).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("refs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const importBibtex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ project_id: z.string().uuid(), bibtex: z.string().min(1).max(50000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const entries = parseBibTeX(data.bibtex);
    if (!entries.length) return { inserted: 0 };
    const rows = entries.map((e) => ({
      project_id: data.project_id,
      cite_key: e.cite_key ?? "ref" + Math.random().toString(36).slice(2, 8),
      authors: e.authors ?? "Unknown",
      title: e.title ?? "Untitled",
      year: e.year ?? null,
      container: e.container ?? null,
      publisher: e.publisher ?? null,
      doi: e.doi ?? null,
      url: e.url ?? null,
    }));
    const { error } = await context.supabase.from("refs").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });
