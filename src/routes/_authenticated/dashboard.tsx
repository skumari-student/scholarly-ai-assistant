import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects, deleteProject } from "@/lib/projects.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { PlusCircle, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — ScholarlyWrite AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  const list = useServerFn(listProjects);
  const del = useServerFn(deleteProject);
  const router = useRouter();
  const q = useQuery({ queryKey: ["projects"], queryFn: () => list() });

  async function remove(id: string) {
    if (!confirm("Delete this project? This cannot be undone.")) return;
    try {
      await del({ data: { id } });
      toast.success("Project deleted");
      q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">My projects</h1>
          <Link to="/projects/new">
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" /> New project
            </Button>
          </Link>
        </div>

        <div className="mt-8">
          {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {q.data && q.data.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="mt-4 font-medium">No projects yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first project to start writing.
              </p>
              <Link to="/projects/new">
                <Button className="mt-4">Create project</Button>
              </Link>
            </div>
          )}
          <div className="grid gap-3">
            {q.data?.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
              >
                <Link
                  to="/projects/$id"
                  params={{ id: p.id }}
                  className="flex-1 min-w-0"
                  onClick={() => router.invalidate()}
                >
                  <div className="font-medium">{p.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.doc_type} · {p.citation_style} · {new Date(p.updated_at).toLocaleDateString()}
                  </div>
                </Link>
                <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
