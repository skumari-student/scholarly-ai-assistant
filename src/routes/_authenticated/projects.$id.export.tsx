import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getProject } from "@/lib/projects.functions";
import { exportProject } from "@/lib/export.functions";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id/export")({
  head: () => ({ meta: [{ title: "Export — ScholarlyWrite AI" }] }),
  component: ExportPage,
});

function ExportPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getProject);
  const exp = useServerFn(exportProject);
  const q = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<"md" | "docx" | null>(null);

  async function download(format: "md" | "docx") {
    setRunning(format);
    try {
      const r = await exp({
        data: {
          project_id: id,
          format,
          section_ids: selected.size ? Array.from(selected) : undefined,
        },
      });
      const bin = atob(r.contentB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: r.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setRunning(null);
    }
  }

  if (!q.data) {
    return (
      <AppShell>
        <div className="p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
      </AppShell>
    );
  }
  const { project, sections } = q.data;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-8">
        <Link to="/projects/$id" params={{ id }} className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
        </Link>
        <h1 className="text-2xl font-semibold">Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">{project.title}</p>

        <div className="mt-6 rounded-lg border border-border p-4">
          <div className="mb-3 text-sm font-medium">Sections to include</div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.size === 0}
                onChange={() => setSelected(new Set())}
              />
              All sections
            </label>
            {sections.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    setSelected(next);
                  }}
                />
                {s.title}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={() => download("docx")} disabled={running !== null}>
            {running === "docx" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Download DOCX
          </Button>
          <Button variant="outline" onClick={() => download("md")} disabled={running !== null}>
            {running === "md" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Download Markdown
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
