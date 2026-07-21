import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "./list-projects";

export default defineTool({
  name: "add_reference",
  title: "Add reference",
  description: "Add a bibliographic reference to a project's library for the signed-in user.",
  inputSchema: {
    project_id: z.string().uuid(),
    title: z.string().min(1),
    authors: z.string().describe("Comma-separated authors, e.g. 'Smith, J.; Doe, A.'").default(""),
    year: z.string().max(10).default(""),
    source: z.string().describe("Journal, book, or publisher.").default(""),
    doi: z.string().default(""),
    url: z.string().default(""),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("refs")
      .insert({ ...input, user_id: ctx.getUserId() })
      .select("id, title")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Added reference: ${data?.title}` }],
      structuredContent: { ref: data },
    };
  },
});
