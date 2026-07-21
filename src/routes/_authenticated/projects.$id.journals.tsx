import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Search, ExternalLink, Star, Check, Trash2 } from "lucide-react";
import { getProject } from "@/lib/projects.functions";
import {
  searchJournals, fitCheck, addToShortlist, listShortlist, removeFromShortlist, updateShortlistStatus,
  type JournalHit,
} from "@/lib/journals.functions";

export const Route = createFileRoute("/_authenticated/projects/$id/journals")({
  head: () => ({ meta: [{ title: "Journals — ScholarlyWrite AI" }] }),
  component: JournalsPage,
});

function JournalsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const proj = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });
  const search = useServerFn(searchJournals);
  const fit = useServerFn(fitCheck);
  const add = useServerFn(addToShortlist);
  const listSl = useServerFn(listShortlist);
  const rm = useServerFn(removeFromShortlist);
  const updSt = useServerFn(updateShortlistStatus);

  const shortlist = useQuery({ queryKey: ["shortlist", id], queryFn: () => listSl({ data: { project_id: id } }) });

  const [query, setQuery] = useState("");
  const [useScopus, setUseScopus] = useState(false);
  const [results, setResults] = useState<JournalHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [fitting, setFitting] = useState<string | null>(null);
  const [fitData, setFitData] = useState<Record<string, any>>({});
  const [minImpact, setMinImpact] = useState(0);
  const [oaOnly, setOaOnly] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await search({ data: { project_id: id, query: query || undefined, use_scopus: useScopus } });
      setResults(r.results);
      if (useScopus && !r.scopus_enabled) toast.warning("Scopus key not configured — showing OpenAlex results only");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Search failed"); }
    finally { setBusy(false); }
  }

  const filtered = results.filter((r) => (!oaOnly || r.openaccess) && (r.impact ?? 0) >= minImpact);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl p-6">
        <Link to="/projects/$id" params={{ id }} className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Journal intelligence</h1>
            <p className="text-sm text-muted-foreground">{proj.data?.project.title}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/projects/$id/lab" params={{ id }}><Button size="sm" variant="outline">Data Lab</Button></Link>
            <Link to="/projects/$id/submit" params={{ id }}><Button size="sm" variant="outline">Submission</Button></Link>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Query (leave blank to use project title)" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-[280px] flex-1" />
            <Button onClick={run} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Find journals</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2"><Switch checked={useScopus} onCheckedChange={setUseScopus} /> Use Scopus (needs SCOPUS_API_KEY)</label>
            <label className="flex items-center gap-2"><Switch checked={oaOnly} onCheckedChange={setOaOnly} /> Open access only</label>
            <label className="flex items-center gap-2">Min impact <Input type="number" min={0} step={0.1} value={minImpact} onChange={(e) => setMinImpact(Number(e.target.value) || 0)} className="h-7 w-16" /></label>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {filtered.map((r) => (
              <div key={r.issn} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">{r.publisher ?? "—"} · ISSN {r.issn}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                      {r.scopus && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 dark:bg-blue-950 dark:text-blue-300">Scopus</span>}
                      {r.doaj && <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-950 dark:text-green-300">DOAJ</span>}
                      {r.openaccess && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300">OA</span>}
                      {r.impact != null && <span className="rounded bg-muted px-1.5 py-0.5">Impact ~{r.impact}</span>}
                      {r.apc != null && <span className="rounded bg-muted px-1.5 py-0.5">APC ${r.apc}</span>}
                      {r.fit_score != null && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">Fit {r.fit_score}</span>}
                    </div>
                    {r.fit_why && <p className="mt-2 text-xs">{r.fit_why}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {r.homepage && <a href={r.homepage} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /></Button></a>}
                    <Button size="sm" variant="outline" onClick={async () => {
                      await add({ data: { project_id: id, issn: r.issn, title: r.title, publisher: r.publisher, homepage: r.homepage, fit: r.fit_score ? { score: r.fit_score, why: r.fit_why } : undefined } });
                      qc.invalidateQueries({ queryKey: ["shortlist", id] });
                      toast.success("Shortlisted");
                    }}><Star className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" disabled={fitting === r.issn} onClick={async () => {
                      setFitting(r.issn);
                      try {
                        const f = await fit({ data: { project_id: id, issn: r.issn } });
                        setFitData((s) => ({ ...s, [r.issn]: f }));
                      } catch (e) { toast.error(e instanceof Error ? e.message : "Fit failed"); }
                      finally { setFitting(null); }
                    }}>{fitting === r.issn ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</Button>
                  </div>
                </div>
                {fitData[r.issn] && (
                  <div className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-xs">
                    <div className="font-medium">Fit check: {fitData[r.issn].score}/100</div>
                    {fitData[r.issn].reasons?.length ? <div className="mt-1"><span className="font-medium">Why: </span>{fitData[r.issn].reasons.join("; ")}</div> : null}
                    {fitData[r.issn].risks?.length ? <div className="mt-1 text-amber-700 dark:text-amber-400"><span className="font-medium">Risks: </span>{fitData[r.issn].risks.join("; ")}</div> : null}
                    {fitData[r.issn].suggestedEdits?.length ? <div className="mt-1"><span className="font-medium">Suggested edits: </span><ul className="ml-4 list-disc">{fitData[r.issn].suggestedEdits.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div> : null}
                  </div>
                )}
              </div>
            ))}
            {!filtered.length && !busy && <p className="text-sm text-muted-foreground">No results yet. Run a search.</p>}
          </div>

          <aside>
            <div className="mb-2 text-sm font-medium">Shortlist ({shortlist.data?.length ?? 0})</div>
            <div className="space-y-2">
              {(shortlist.data ?? []).map((s: any) => (
                <div key={s.id} className="rounded-md border border-border bg-card p-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{s.title}</div>
                      <div className="text-[10px] text-muted-foreground">{s.publisher ?? ""}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={async () => { await rm({ data: { id: s.id } }); qc.invalidateQueries({ queryKey: ["shortlist", id] }); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <Select value={s.status} onValueChange={async (v) => { await updSt({ data: { id: s.id, status: v as any } }); qc.invalidateQueries({ queryKey: ["shortlist", id] }); }}>
                    <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="considering">Considering</SelectItem>
                      <SelectItem value="target">Target</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {!shortlist.data?.length && <p className="text-xs text-muted-foreground">Nothing shortlisted yet.</p>}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
