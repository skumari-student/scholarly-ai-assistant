import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "./list-projects";

export default defineTool({
  name: "update_section_content",
  title: "Update section content",
  description: "Replace the content of a section in the signed-in user's project. Optionally set status to 'draft' or 'completed'.",
  inputSchema: {
    section_id: z.string().uuid().describe("Section UUID."),
    content: z.string().describe("Full new content for the section (markdown-friendly plain text)."),
    status: z.enum(["draft", "completed"]).optional().describe("Optional new status."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async ({ section_id, content, status }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const patch: Record<string, unknown> = { content };
    if (status) patch.status = status;
    const { data, error } = await supabaseForUser(ctx)
      .from("sections")
      .update(patch)
      .eq("id", section_id)
      .select("id, key, title, status")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: "Section not found or not accessible" }], isError: true };
    return {
      content: [{ type: "text", text: `Updated section ${data.title}` }],
      structuredContent: { section: data },
    };
  },
});
