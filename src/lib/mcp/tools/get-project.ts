import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "./list-projects";

export default defineTool({
  name: "get_project",
  title: "Get project",
  description: "Fetch one project with its sections and references for the signed-in user.",
  inputSchema: { project_id: z.string().uuid().describe("Project UUID.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const [proj, sections, refs] = await Promise.all([
      supabase.from("projects").select("*").eq("id", project_id).maybeSingle(),
      supabase.from("sections").select("id, key, title, order, content, status").eq("project_id", project_id).order("order"),
      supabase.from("refs").select("id, title, authors, year, source, doi, url").eq("project_id", project_id),
    ]);
    if (proj.error) return { content: [{ type: "text", text: proj.error.message }], isError: true };
    if (!proj.data) return { content: [{ type: "text", text: "Project not found" }], isError: true };
    const payload = { project: proj.data, sections: sections.data ?? [], refs: refs.data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
