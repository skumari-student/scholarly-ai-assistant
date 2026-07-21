import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Check, Download, Loader2, Sparkles, X } from "lucide-react";
import { getProject } from "@/lib/projects.functions";
import { listShortlist } from "@/lib/journals.functions";
import {
  getSubmission, upsertSubmission, generateCoverLetter, buildChecklist, verifyCitations, exportSubmissionPackage,
  type SubmissionRow, type ChecklistItem,
} from "@/lib/submission.functions";

export const Route = createFileRoute("/_authenticated/projects/$id/submit")({
  head: () => ({ meta: [{ title: "Submission — ScholarlyWrite AI" }] }),
  component: SubmissionPage,
});

function SubmissionPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const getSub = useServerFn(getSubmission);
  const upsert = useServerFn(upsertSubmission);
  const genLetter = useServerFn(generateCoverLetter);
  const check = useServerFn(buildChecklist);
  const verify = useServerFn(verifyCitations);
  const pack = useServerFn(exportSubmissionPackage);
  const listSl = useServerFn(listShortlist);

  const proj = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });
  const sub = useQuery({ queryKey: ["submission", id], queryFn: () => getSub({ data: { project_id: id } }) });
  const shortlist = useQuery({ queryKey: ["shortlist", id], queryFn: () => listSl({ data: { project_id: id } }) });
  const checklist = useQuery({ queryKey: ["checklist", id], queryFn: () => check({ data: { project_id: id } }) });
  const cite = useQuery({ queryKey: ["cite-verify", id], queryFn: () => verify({ data: { project_id: id } }) });

  const [cover, setCover] = useState("");
  const [targetIssn, setTargetIssn] = useState<string | null>(null);
  const [targetTitle, setTargetTitle] = useState<string | null>(null);
  const [pkg, setPkg] = useState<SubmissionRow["package"]>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sub.data) {
      setCover(sub.data.cover_letter ?? "");
      setTargetIssn(sub.data.target_issn);
      setTargetTitle(sub.data.target_title);
      setPkg(sub.data.package ?? {});
    }
  }, [sub.data]);

  async function save(next: Partial<SubmissionRow>) {
    await upsert({ data: { project_id: id, cover_letter: cover, target_issn: targetIssn, target_title: targetTitle, package: pkg, ...next } });
    qc.invalidateQueries({ queryKey: ["submission", id] });
  }

  async function generate() {
    setBusy(true);
    try {
      const r = await genLetter({ data: { project_id: id, issn: targetIssn ?? undefined } });
      setCover(r.cover_letter);
      toast.success("Draft ready — review and save");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function download() {
    const r = await pack({ data: { project_id: id } });
    const bin = atob(r.contentB64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: r.mime }));
    const a = document.createElement("a"); a.href = url; a.download = r.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  const okCount = (checklist.data ?? []).filter((i) => i.ok).length;
  const totalCount = (checklist.data ?? []).length;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        <Link to="/projects/$id" params={{ id }} className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Submission assistant</h1>
            <p className="text-sm text-muted-foreground">{proj.data?.project.title}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/projects/$id/lab" params={{ id }}><Button size="sm" variant="outline">Data Lab</Button></Link>
            <Link to="/projects/$id/journals" params={{ id }}><Button size="sm" variant="outline">Journals</Button></Link>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Target journal</h2>
              <Select value={targetIssn ?? ""} onValueChange={(v) => {
                const j = (shortlist.data ?? []).find((s: any) => s.issn === v);
                setTargetIssn(v); setTargetTitle(j?.title ?? null);
              }}>
                <SelectTrigger className="mt-2"><SelectValue placeholder="Pick from shortlist" /></SelectTrigger>
                <SelectContent>
                  {(shortlist.data ?? []).map((s: any) => (
                    <SelectItem key={s.issn} value={s.issn}>{s.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!shortlist.data?.length && <p className="mt-2 text-xs text-muted-foreground">Shortlist journals in the Journals tab first.</p>}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Cover letter</h2>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}Generate
                  </Button>
                  <Button size="sm" onClick={() => save({})}>Save</Button>
                </div>
              </div>
              <Textarea rows={14} value={cover} onChange={(e) => setCover(e.target.value)} className="mt-2 font-serif text-sm" />
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Author disclosures</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div><Label className="text-xs">Corresponding author</Label><Input value={pkg.corresponding_author ?? ""} onChange={(e) => setPkg({ ...pkg, corresponding_author: e.target.value })} /></div>
                <div><Label className="text-xs">Funding</Label><Input value={pkg.funding ?? ""} onChange={(e) => setPkg({ ...pkg, funding: e.target.value })} /></div>
                <div><Label className="text-xs">Conflicts of interest</Label><Input value={pkg.conflicts ?? ""} onChange={(e) => setPkg({ ...pkg, conflicts: e.target.value })} /></div>
                <div><Label className="text-xs">Data availability</Label><Input value={pkg.data_availability ?? ""} onChange={(e) => setPkg({ ...pkg, data_availability: e.target.value })} /></div>
                <div className="sm:col-span-2"><Label className="text-xs">Author contributions (CRediT)</Label><Textarea rows={2} value={pkg.contributions ?? ""} onChange={(e) => setPkg({ ...pkg, contributions: e.target.value })} /></div>
              </div>
              <Button size="sm" className="mt-3" onClick={() => save({})}>Save disclosures</Button>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Reference verification</h2>
                <Button size="sm" variant="ghost" onClick={() => qc.invalidateQueries({ queryKey: ["cite-verify", id] })}>Re-check</Button>
              </div>
              {!cite.data ? <Loader2 className="mt-2 h-4 w-4 animate-spin" /> : cite.data.problems.length === 0 ? (
                <p className="mt-2 text-sm text-green-700 dark:text-green-400">All {cite.data.total} references look complete.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {cite.data.problems.map((p, i) => (
                    <li key={i} className="rounded-md border border-border p-2">
                      <div className="font-medium">{p.ref}</div>
                      <div className="text-xs text-amber-700 dark:text-amber-400">{p.issues.join(", ")}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Checklist</h3>
                <span className="text-xs text-muted-foreground">{okCount}/{totalCount}</span>
              </div>
              <ul className="space-y-1 text-sm">
                {(checklist.data ?? []).map((i: ChecklistItem) => (
                  <li key={i.id} className="flex items-start gap-2">
                    {i.ok ? <Check className="mt-0.5 h-4 w-4 text-green-600" /> : <X className="mt-0.5 h-4 w-4 text-amber-600" />}
                    <div>
                      <div>{i.label}</div>
                      {i.note && <div className="text-[10px] text-muted-foreground">{i.note}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2 text-sm font-semibold">Package</h3>
              <Button className="w-full" onClick={download}><Download className="mr-2 h-4 w-4" />Download DOCX</Button>
              <p className="mt-2 text-[10px] text-muted-foreground">Combined title page, cover letter, disclosures, manuscript and references.</p>
              <div className="mt-3">
                <Label className="text-xs">Status</Label>
                <Select value={sub.data?.status ?? "draft"} onValueChange={async (v) => { await save({ status: v as any }); }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                  </SelectContent>
                </Select>
                {sub.data?.submitted_at && <p className="mt-2 text-[10px] text-muted-foreground">Submitted {new Date(sub.data.submitted_at).toLocaleDateString()}</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
