import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseCsv, parseXlsx, type ParsedDataset } from "./analysis.server";

export interface DatasetRow {
  id: string;
  project_id: string;
  upload_id: string | null;
  name: string;
  source: "upload" | "paste" | "section";
  kind: "quant" | "qual" | "mixed";
  columns: string[];
  row_count: number;
  sample: (string | number)[][];
  text_content: string | null;
  created_at: string;
}

const registerSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(160),
  source: z.enum(["upload", "paste", "section"]),
  kind: z.enum(["quant", "qual", "mixed"]).default("quant"),
  upload_id: z.string().uuid().optional(),
  inline_csv: z.string().max(200000).optional(),
  text_content: z.string().max(200000).optional(),
});

export const listDatasets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("datasets")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as DatasetRow[];
  });

export const registerDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => registerSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let parsed: ParsedDataset | null = null;
    let text: string | null = null;

    if (data.kind === "qual") {
      if (data.text_content && data.text_content.trim()) {
        text = data.text_content.slice(0, 200000);
      } else if (data.upload_id) {
        const { data: up } = await (supabase as any)
          .from("uploads").select("path,name,mime").eq("id", data.upload_id).single();
        if (!up?.path) throw new Error("Upload not found");
        const { data: file } = await supabase.storage.from("project-uploads").download(up.path);
        if (!file) throw new Error("Could not download file");
        text = (await file.text()).slice(0, 200000);
      } else {
        throw new Error("Provide text or an upload");
      }
    } else {
      if (data.inline_csv && data.inline_csv.trim()) {
        parsed = parseCsv(data.inline_csv);
      } else if (data.upload_id) {
        const { data: up } = await (supabase as any)
          .from("uploads").select("path,name,mime").eq("id", data.upload_id).single();
        if (!up?.path) throw new Error("Upload not found");
        const { data: file } = await supabase.storage.from("project-uploads").download(up.path);
        if (!file) throw new Error("Could not download file");
        const isXlsx = /\.xlsx?$/i.test(up.name) || /spreadsheet|excel/i.test(up.mime ?? "");
        parsed = isXlsx ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await file.text());
      } else {
        throw new Error("Provide CSV or upload");
      }
    }

    const row = {
      project_id: data.project_id,
      user_id: userId,
      upload_id: data.upload_id ?? null,
      name: data.name,
      source: data.source,
      kind: data.kind,
      columns: parsed?.columns ?? [],
      row_count: parsed?.rowCount ?? (text ? text.split(/\s+/).length : 0),
      sample: parsed?.rows ?? [],
      text_content: text,
    };
    const { data: inserted, error } = await (supabase as any)
      .from("datasets").insert(row).select().single();
    if (error) throw new Error(error.message);
    return inserted as DatasetRow;
  });

export const deleteDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("datasets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
