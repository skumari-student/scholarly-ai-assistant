import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getProject } from "@/lib/projects.functions";
import { exportProject } from "@/lib/export.functions";
import { toast } from "sonner";
import { Loader2, ArrowLeft, Download, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id/export")({
  head: () => ({ meta: [{ title: "Export — ScholarlyWrite AI" }] }),
  component: ExportPage,
});

type Format = "docx" | "pdf" | "md";
type Scope = "full" | "section";

function ExportPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getProject);
  const exp = useServerFn(exportProject);
  const q = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });
  const [format, setFormat] = useState<Format>("docx");
  const [scope, setScope] = useState<Scope>("full");
  const [sectionId, setSectionId] = useState<string>("");
  const [draft, setDraft] = useState<boolean>(true);
  const [running, setRunning] = useState(false);

  async function handleExport() {
    if (!q.data) return;
    if (scope === "section" && !sectionId) {
      toast.error("Choose a section to export");
      return;
    }
    setRunning(true);
    const t = toast.loading(`Generating ${format.toUpperCase()}…`);
    try {
      if (format === "pdf") {
        // Server produces printable HTML; browser prints to PDF.
        const r = await exp({
          data: {
            project_id: id,
            format: "html",
            scope,
            section_id: scope === "section" ? sectionId : undefined,
            draft,
          },
        });
        const html = new TextDecoder().decode(base64ToBytes(r.contentB64));
        openPrintWindow(html);
        toast.success("Opened print dialog — choose 'Save as PDF'", { id: t });
      } else {
        const r = await exp({
          data: {
            project_id: id,
            format,
            scope,
            section_id: scope === "section" ? sectionId : undefined,
            draft,
          },
        });
        const bytes = base64ToBytes(r.contentB64);
        const blob = new Blob([bytes as BlobPart], { type: r.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = r.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success(`${r.filename} downloaded`, { id: t });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed", { id: t });
    } finally {
      setRunning(false);
    }
  }

  if (!q.data) {
    return (
      <AppShell>
        <div className="p-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </AppShell>
    );
  }
  const { project, sections } = q.data;
  const isCompleted = project.status === "completed";

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-8">
        <Link
          to="/projects/$id"
          params={{ id }}
          className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Export</h1>
            <p className="mt-1 text-sm text-muted-foreground">{project.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isCompleted
                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isCompleted ? "Completed" : "Draft"}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {project.citation_style}
            </span>
          </div>
        </div>

        <div className="mt-6 space-y-4 rounded-lg border border-border p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="docx">DOCX (Word)</SelectItem>
                  <SelectItem value="pdf">PDF (via print)</SelectItem>
                  <SelectItem value="md">Markdown</SelectItem>
                </SelectContent>
              </Select>
              {format === "pdf" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Opens a print dialog. Choose “Save as PDF” as the destination.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full document</SelectItem>
                  <SelectItem value="section">Current section only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {scope === "section" && (
            <div>
              <Label className="text-xs">Section</Label>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a section" />
                </SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
            <div>
              <Label className="text-xs font-medium">Draft version</Label>
              <p className="text-[11px] text-muted-foreground">
                Adds a “DRAFT — not for distribution” note / watermark. Turn off for a clean final copy.
              </p>
            </div>
            <Switch checked={draft} onCheckedChange={setDraft} />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleExport} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : format === "pdf" ? (
              <Printer className="mr-2 h-4 w-4" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {format === "pdf" ? "Open print dialog" : `Download ${format.toUpperCase()}`}
          </Button>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Uses your latest saved content and current citation style ({project.citation_style}).
        </p>
      </div>
    </AppShell>
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function openPrintWindow(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  const trigger = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // Fallback: open HTML in a new tab so the user can print manually
      const w = window.open();
      if (w) { w.document.write(html); w.document.close(); }
      else toast.error("Pop-up blocked — allow pop-ups to print to PDF");
    } finally {
      cleanup();
    }
  };
  const tryPrint = () => {
    const d = iframe.contentDocument;
    if (d && d.readyState === "complete") setTimeout(trigger, 350);
    else setTimeout(tryPrint, 200);
  };
  iframe.onload = () => setTimeout(trigger, 350);
  // Also poll in case onload doesn't fire (some browsers with srcdoc)
  setTimeout(tryPrint, 300);
}
