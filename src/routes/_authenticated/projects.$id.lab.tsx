import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2, Play, Sparkles, Paperclip } from "lucide-react";
import { getProject } from "@/lib/projects.functions";
import { listDatasets, registerDataset, deleteDataset, type DatasetRow } from "@/lib/datasets.functions";
import { runQuantAnalysis, getDatasetColumnTypes, type QuantResult, type QuantMethod } from "@/lib/ai/quant.functions";
import { runQualAnalysis, type QualResult } from "@/lib/ai/qual.functions";
import { attachVisual, listVisuals, deleteVisual } from "@/lib/visuals.functions";
import { listUploads, createUploadUrl, recordUpload } from "@/lib/uploads.functions";
import { supabase } from "@/integrations/supabase/client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_authenticated/projects/$id/lab")({
  head: () => ({ meta: [{ title: "Data Lab — ScholarlyWrite AI" }] }),
  component: LabPage,
});

function LabPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const list = useServerFn(listDatasets);
  const listVis = useServerFn(listVisuals);
  const delVis = useServerFn(deleteVisual);
  const project = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });
  const datasets = useQuery({ queryKey: ["datasets", id], queryFn: () => list({ data: { project_id: id } }) });
  const attached = useQuery({ queryKey: ["visuals", id], queryFn: () => listVis({ data: { project_id: id } }) });

  if (!project.data) {
    return (<AppShell><div className="p-8"><Loader2 className="h-5 w-5 animate-spin" /></div></AppShell>);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-6">
        <Link to="/projects/$id" params={{ id }} className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Data Lab</h1>
            <p className="text-sm text-muted-foreground">{project.data.project.title}</p>
          </div>
          <div className="flex gap-2">
            <Link to="/projects/$id/journals" params={{ id }}><Button size="sm" variant="outline">Journals</Button></Link>
            <Link to="/projects/$id/submit" params={{ id }}><Button size="sm" variant="outline">Submission</Button></Link>
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[280px_1fr]">
          <DatasetsPanel projectId={id} datasets={datasets.data ?? []} onChange={() => qc.invalidateQueries({ queryKey: ["datasets", id] })} />
          <AnalysisPanel projectId={id} datasets={datasets.data ?? []} onAttached={() => qc.invalidateQueries({ queryKey: ["visuals", id] })} />
        </div>

        <div className="mt-8">
          <div className="mb-2 text-sm font-medium">Attached to export ({attached.data?.length ?? 0})</div>
          <div className="grid gap-2">
            {(attached.data ?? []).map((v: any) => (
              <div key={v.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{v.title}</div>
                  <div className="text-xs text-muted-foreground">{v.kind}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={async () => {
                  await delVis({ data: { id: v.id } });
                  qc.invalidateQueries({ queryKey: ["visuals", id] });
                }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
            {!attached.data?.length && <p className="text-xs text-muted-foreground">Nothing attached yet.</p>}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function DatasetsPanel({ projectId, datasets, onChange }: { projectId: string; datasets: DatasetRow[]; onChange: () => void }) {
  const reg = useServerFn(registerDataset);
  const del = useServerFn(deleteDataset);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"quant" | "qual">("quant");
  const [inline, setInline] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const createUrl = useServerFn(createUploadUrl);
  const record = useServerFn(recordUpload);

  async function submit() {
    if (!name.trim()) { toast.error("Name your dataset"); return; }
    setBusy(true);
    try {
      let upload_id: string | undefined;
      let text_content: string | undefined;
      let inline_csv: string | undefined;
      if (file) {
        const { path, uploadUrl, token } = await createUrl({ data: { project_id: projectId, filename: file.name } } as any);
        const { error } = await supabase.storage.from("project-uploads").uploadToSignedUrl(path, token, file);
        if (error) throw new Error(error.message);
        const up = await record({ data: { project_id: projectId, path, name: file.name, mime: file.type, size: file.size, kind: "file" } } as any);
        upload_id = (up as any).id;
      } else if (kind === "qual") {
        text_content = inline;
      } else {
        inline_csv = inline;
      }
      await reg({ data: { project_id: projectId, name, source: file ? "upload" : "paste", kind, upload_id, inline_csv, text_content } });
      toast.success("Dataset added");
      setName(""); setInline(""); setFile(null); onChange();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-sm font-medium">New dataset</div>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="mb-2" />
        <Select value={kind} onValueChange={(v) => setKind(v as any)}>
          <SelectTrigger className="mb-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="quant">Quantitative (CSV/XLSX)</SelectItem>
            <SelectItem value="qual">Qualitative (text)</SelectItem>
          </SelectContent>
        </Select>
        <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-2 py-2 text-xs">
          <Paperclip className="h-3.5 w-3.5" />
          <span className="flex-1 truncate">{file ? file.name : "Upload file"}</span>
          <input type="file" hidden accept={kind === "qual" ? ".txt,.md" : ".csv,.xlsx,.xls"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="text-center text-[10px] text-muted-foreground">or paste</div>
        <Textarea placeholder={kind === "qual" ? "Paste interview transcript…" : "Group,Pre,Post\nControl,12,14"} value={inline} onChange={(e) => setInline(e.target.value)} rows={4} className="mt-2 font-mono text-xs" />
        <Button size="sm" className="mt-2 w-full" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null} Add
        </Button>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Datasets ({datasets.length})</div>
        <div className="space-y-1">
          {datasets.map((d) => (
            <div key={d.id} className="rounded-md border border-border bg-card px-2 py-1.5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{d.name}</div>
                <Button size="sm" variant="ghost" onClick={async () => { await del({ data: { id: d.id } }); onChange(); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground">{d.kind} · {d.row_count} rows · {d.columns.length} cols</div>
            </div>
          ))}
          {!datasets.length && <p className="text-xs text-muted-foreground">No datasets yet.</p>}
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ projectId, datasets, onAttached }: { projectId: string; datasets: DatasetRow[]; onAttached: () => void }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(() => datasets.find((d) => d.id === selectedId), [datasets, selectedId]);
  const [tab, setTab] = useState<"quant" | "qual">("quant");
  const [method, setMethod] = useState<QuantMethod>("descriptive");
  const [xCol, setXCol] = useState<string>("");
  const [yCol, setYCol] = useState<string>("");
  const [gCol, setGCol] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuantResult | QualResult | null>(null);

  const runQuant = useServerFn(runQuantAnalysis);
  const runQual = useServerFn(runQualAnalysis);
  const attach = useServerFn(attachVisual);

  const colTypes = useQuery({
    queryKey: ["colTypes", selectedId],
    queryFn: () => useServerFn(getDatasetColumnTypes)({ data: { dataset_id: selectedId } } as any),
    enabled: !!selectedId && selected?.kind !== "qual",
  });

  async function run() {
    if (!selected) { toast.error("Pick a dataset"); return; }
    setBusy(true); setResult(null);
    try {
      if (selected.kind === "qual") {
        const r = await runQual({ data: { project_id: projectId, dataset_id: selected.id, kind: "codes_themes", prompt } });
        setResult(r);
      } else {
        const r = await runQuant({ data: { project_id: projectId, dataset_id: selected.id, method, x_col: xCol || undefined, y_col: yCol || undefined, group_col: gCol || undefined, columns: xCol ? [xCol] : [] } });
        setResult(r);
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function attachResult() {
    if (!result) return;
    const isQuant = "method" in result;
    await attach({
      data: {
        project_id: projectId,
        kind: isQuant ? `analysis:quant:${(result as QuantResult).method}` : "analysis:qual",
        title: result.title,
        caption: (isQuant ? (result as QuantResult).narrative : (result as QualResult).summary).slice(0, 500),
        payload: isQuant
          ? { summary: (result as QuantResult).narrative, table: result.table, keyFindings: [], recommendedCharts: (result as QuantResult).chart ? [{ ...(result as QuantResult).chart, title: result.title, rationale: (result as QuantResult).narrative }] : [], citations: [] }
          : { summary: (result as QualResult).summary, table: (result as QualResult).table, keyFindings: (result as QualResult).themes.map((t) => `${t.name}: ${t.rationale}`), citations: (result as QualResult).citations },
      },
    });
    toast.success("Attached to export"); onAttached();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <Label className="text-xs">Dataset</Label>
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Choose a dataset" /></SelectTrigger>
          <SelectContent>
            {datasets.map((d) => <SelectItem key={d.id} value={d.id}>{d.name} ({d.kind})</SelectItem>)}
          </SelectContent>
        </Select>

        {selected && (
          <Tabs value={selected.kind === "qual" ? "qual" : tab} onValueChange={(v) => setTab(v as any)} className="mt-4">
            <TabsList>
              <TabsTrigger value="quant" disabled={selected.kind === "qual"}>Quantitative</TabsTrigger>
              <TabsTrigger value="qual" disabled={selected.kind === "quant"}>Qualitative</TabsTrigger>
            </TabsList>
            <TabsContent value="quant" className="space-y-3 pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select value={method} onValueChange={(v) => setMethod(v as QuantMethod)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="descriptive">Descriptive stats</SelectItem>
                      <SelectItem value="correlation">Correlation matrix</SelectItem>
                      <SelectItem value="ttest">Group comparison (t-test)</SelectItem>
                      <SelectItem value="regression">Linear regression</SelectItem>
                      <SelectItem value="frequency">Frequency table</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(method === "ttest" || method === "regression" || method === "frequency") && (
                  <div>
                    <Label className="text-xs">{method === "ttest" ? "Group column" : method === "regression" ? "X column" : "Column"}</Label>
                    <Select value={method === "ttest" ? gCol : xCol} onValueChange={(v) => method === "ttest" ? setGCol(v) : setXCol(v)}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Pick" /></SelectTrigger>
                      <SelectContent>
                        {(colTypes.data ?? []).map((c) => <SelectItem key={c.name} value={c.name}>{c.name}{c.numeric ? " (num)" : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(method === "ttest" || method === "regression") && (
                  <div>
                    <Label className="text-xs">Y column (numeric)</Label>
                    <Select value={yCol} onValueChange={setYCol}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Pick" /></SelectTrigger>
                      <SelectContent>
                        {(colTypes.data ?? []).filter((c) => c.numeric).map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="qual" className="space-y-3 pt-3">
              <Label className="text-xs">Instruction</Label>
              <Textarea placeholder="Focus on participant motivations…" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </TabsContent>
          </Tabs>
        )}

        <Button className="mt-4" onClick={run} disabled={busy || !selected}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Run analysis
        </Button>
      </div>

      {result && <ResultCard result={result} onAttach={attachResult} />}
    </div>
  );
}

function ResultCard({ result, onAttach }: { result: QuantResult | QualResult; onAttach: () => void }) {
  const isQuant = "method" in result;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{result.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{isQuant ? (result as QuantResult).narrative : (result as QualResult).summary}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onAttach}><Sparkles className="mr-1 h-3 w-3" /> Attach</Button>
      </div>

      {isQuant && (result as QuantResult).chart && (
        <div className="mt-4 h-56">
          <QuantChart chart={(result as QuantResult).chart!} />
        </div>
      )}

      {result.table.columns.length > 0 && (
        <div className="mt-4 overflow-auto">
          <table className="w-full text-xs">
            <thead><tr>{result.table.columns.map((c) => <th key={c} className="border-b border-border p-1 text-left">{c}</th>)}</tr></thead>
            <tbody>
              {result.table.rows.map((r, i) => (
                <tr key={i}>{result.table.columns.map((_, j) => <td key={j} className="border-b border-border p-1">{String(r[j] ?? "")}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isQuant && (result as QualResult).themes.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-medium uppercase text-muted-foreground">Themes</div>
          {(result as QualResult).themes.map((t) => (
            <div key={t.name} className="mt-2 rounded-md border border-border p-2">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="text-xs text-muted-foreground">{t.rationale}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Codes: {t.codes.join(", ")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuantChart({ chart }: { chart: NonNullable<QuantResult["chart"]> }) {
  if (chart.type === "scatter") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart>
          <CartesianGrid />
          <XAxis dataKey="label" name={chart.x} />
          <YAxis dataKey="value" name={chart.y} />
          <Tooltip />
          <Scatter data={chart.data} fill="hsl(var(--primary))" />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  if (chart.type === "heatmap") {
    // simple text grid
    const labels = Array.from(new Set(chart.data.map((d) => d.series ?? ""))).filter(Boolean);
    return (
      <div className="grid gap-px overflow-auto text-[10px]" style={{ gridTemplateColumns: `auto ${labels.map(() => "1fr").join(" ")}` }}>
        <div />{labels.map((l) => <div key={l} className="p-1 font-medium">{l}</div>)}
        {labels.map((row) => (
          <>
            <div key={`r${row}`} className="p-1 font-medium">{row}</div>
            {labels.map((col) => {
              const cell = chart.data.find((d) => d.series === row && d.label === `${row}×${col}`);
              const v = cell?.value ?? 0;
              const hue = v > 0 ? 200 : 0;
              return <div key={`${row}-${col}`} className="p-1 text-center" style={{ background: `hsla(${hue},70%,50%,${Math.abs(v) * 0.6})` }}>{v.toFixed(2)}</div>;
            })}
          </>
        ))}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chart.data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" fill="hsl(var(--primary))" />
      </BarChart>
    </ResponsiveContainer>
  );
}
