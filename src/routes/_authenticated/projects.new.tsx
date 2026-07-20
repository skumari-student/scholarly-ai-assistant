import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createProject } from "@/lib/projects.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DOC_TYPES, CITATION_STYLES, LANGUAGE_LEVELS } from "@/lib/doc-templates";
import { toast } from "sonner";
import { VoiceCapture } from "@/components/voice-capture";

export const Route = createFileRoute("/_authenticated/projects/new")({
  head: () => ({ meta: [{ title: "New project — ScholarlyWrite AI" }] }),
  component: NewProject,
});

function NewProject() {
  const create = useServerFn(createProject);
  const navigate = useNavigate();
  const [state, setState] = useState({
    title: "",
    doc_type: "research_paper",
    discipline: "",
    citation_style: "APA" as (typeof CITATION_STYLES)[number],
    language_level: "advanced" as "basic" | "intermediate" | "advanced",
    mode: "low" as "low" | "advanced",
    context_notes: "",
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const proj = await create({ data: state });
      toast.success("Project created");
      navigate({ to: "/projects/$id", params: { id: proj.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up your document. You can dictate context now — the transcript becomes your project notes.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              required
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
              placeholder="e.g. AI Adoption in Higher Education"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Document type</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={state.doc_type}
                onChange={(e) => setState({ ...state, doc_type: e.target.value })}
              >
                {Object.entries(DOC_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Discipline</Label>
              <Input
                value={state.discipline}
                onChange={(e) => setState({ ...state, discipline: e.target.value })}
                placeholder="e.g. Education, Public Health"
              />
            </div>
            <div>
              <Label>Citation style</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={state.citation_style}
                onChange={(e) => setState({ ...state, citation_style: e.target.value as any })}
              >
                {CITATION_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Language level</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={state.language_level}
                onChange={(e) => setState({ ...state, language_level: e.target.value as any })}
              >
                {LANGUAGE_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>AI mode</Label>
              <select
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={state.mode}
                onChange={(e) => setState({ ...state, mode: e.target.value as any })}
              >
                <option value="low">Low credit (fast, concise)</option>
                <option value="advanced">Advanced (deeper drafts)</option>
              </select>
            </div>
          </div>

          <div>
            <Label>Project notes / research context</Label>
            <Textarea
              rows={6}
              value={state.context_notes}
              onChange={(e) => setState({ ...state, context_notes: e.target.value })}
              placeholder="Research problem, aims, methodology, target audience…"
            />
            <div className="mt-2">
              <VoiceCapture
                onTranscript={(t) =>
                  setState((s) => ({ ...s, context_notes: (s.context_notes + " " + t).trim() }))
                }
              />
            </div>
          </div>

          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create project"}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
