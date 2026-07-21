import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "project-uploads";

function kindFor(mime: string): "image" | "file" {
  return mime.startsWith("image/") ? "image" : "file";
}

export const listUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("uploads")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const items = rows ?? [];
    // Attach signed URLs (1h) for viewing / linking
    const withUrls = await Promise.all(
      items.map(async (r: any) => {
        const { data: signed } = await context.supabase.storage
          .from(BUCKET)
          .createSignedUrl(r.path, 60 * 60);
        return { ...r, signed_url: signed?.signedUrl ?? null };
      }),
    );
    return withUrls;
  });

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        name: z.string().min(1).max(300),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Confirm ownership
    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id,user_id")
      .eq("id", data.project_id)
      .single();
    if (pErr || !proj) throw new Error("Project not found");
    const safe = data.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const path = `${context.userId}/${data.project_id}/${crypto.randomUUID()}-${safe}`;
    const { data: signed, error } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message || "Could not create upload URL");
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const recordUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        path: z.string().min(1),
        name: z.string().min(1),
        mime: z.string().min(1),
        size: z.number().int().nonnegative(),
        section_id: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = {
      project_id: data.project_id,
      user_id: context.userId,
      section_id: data.section_id ?? null,
      path: data.path,
      name: data.name.slice(0, 300),
      mime: data.mime.slice(0, 120),
      size: data.size,
      kind: kindFor(data.mime),
    };
    const { data: inserted, error } = await (context.supabase as any)
      .from("uploads")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const attachUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        section_id: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("uploads")
      .update({ section_id: data.section_id })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await (context.supabase as any)
      .from("uploads")
      .select("path")
      .eq("id", data.id)
      .single();
    if (row?.path) {
      await context.supabase.storage.from(BUCKET).remove([row.path]);
    }
    const { error } = await (context.supabase as any).from("uploads").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
