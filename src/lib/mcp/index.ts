import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProjects from "./tools/list-projects";
import getProject from "./tools/get-project";
import updateSection from "./tools/update-section";
import addReference from "./tools/add-reference";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "scholarlywrite-ai-mcp",
  title: "ScholarlyWrite AI",
  version: "0.1.0",
  instructions:
    "Tools for the signed-in user's ScholarlyWrite AI account. Use `list_projects` to discover projects, `get_project` to read sections and references, `update_section_content` to write section drafts, and `add_reference` to grow the library.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProjects, getProject, updateSection, addReference],
});
