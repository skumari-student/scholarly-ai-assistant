import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { VoiceCapture } from "@/components/voice-capture";
import { toast } from "sonner";
import {
  getProject,
  updateSection,
  updateProjectMode,
  updateProjectStatus,
  updateProjectCitationStyle,
} from "@/lib/projects.functions";
import { citeAllSections, runWritingAction } from "@/lib/ai/writing.functions";
import {
  generateTopics,
  togglePinTopic,
  deleteTopic,
  brainstormIdeas,
  extractTopicFromText,
  insertTopics,
} from "@/lib/ai/topics.functions";
import { generateJournals, togglePinJournal, deleteJournal } from "@/lib/ai/journals.functions";
import {
  runVoiceCommand,
  saveTranscript,
  extractFromNarration,
} from "@/lib/ai/voice.functions";
import { generateVisual, type GeneratedVisual } from "@/lib/ai/visuals.functions";
import {
  analyzeDataset,
  analyzeSectionText,
  type AnalysisResult,
  type RecommendedChart,
} from "@/lib/ai/analysis.functions";
import { attachVisual, listVisuals, deleteVisual, type AttachedVisual } from "@/lib/visuals.functions";
import { addReference, deleteReference, importBibtex } from "@/lib/refs.functions";
import {
  listUploads,
  createUploadUrl,
  recordUpload,
  attachUpload,
  deleteUpload,
} from "@/lib/uploads.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatReferenceList, inTextCitation, type Reference } from "@/lib/citations";
import { CITATION_STYLES, type CitationStyle } from "@/lib/doc-templates";
import { countWords } from "@/lib/text";
import { Pin, Trash2, Loader2, Sparkles, FileDown, Save, Check, Quote, Table2, ExternalLink, Upload, Paperclip, Copy, Link2, X, BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  Scatter,
  ScatterChart,
  ZAxis,
  Tooltip,
} from "recharts";

export const Route = createFileRoute("/_authenticated/projects/$id/")({
  head: () => ({ meta: [{ title: "Editor — ScholarlyWrite AI" }] }),
  component: Workspace,
});

const WRITING_ACTIONS = [
  { key: "outline", label: "Outline" },
  { key: "draft", label: "Draft" },
  { key: "expand", label: "Expand" },
  { key: "condense", label: "Condense" },
  { key: "academic", label: "Academic tone" },
  { key: "coherence", label: "Coherence" },
  { key: "redundancy", label: "Redundancy" },
  { key: "clarify_method", label: "Clarify method" },
  { key: "clarify_framework", label: "Clarify framework" },
  { key: "plagiarism_check", label: "Plagiarism risk" },
  { key: "cite", label: "Add citations" },
] as const;

const LIT_REVIEW_KEYS = new Set(["literature", "lit_review", "literature_review", "themes"]);

function Workspace() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const q = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });

  if (q.isLoading) {
    return (
      <AppShell>
        <div className="p-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </AppShell>
    );
  }
  if (!q.data) {
    return (
      <AppShell>
        <div className="p-8">Project not found.</div>
      </AppShell>
    );
  }
  const { project, sections, refs, topics, journals, usage_count } = q.data;
  return (
    <AppShell>
      <ProjectView
        project={project}
        sections={sections as any}
        refs={refs as any}
        topics={topics as any}
        journals={journals as any}
        usageCount={usage_count}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
      />
    </AppShell>
  );
}

interface Section {
  id: string;
  key: string;
  title: string;
  order: number;
  outline: string | null;
  content: string;
}

type SaveState = "idle" | "dirty" | "saving" | "saved";

function ProjectView({
  project,
  sections,
  refs,
  topics,
  journals,
  usageCount,
  onRefresh,
}: {
  project: any;
  sections: Section[];
  refs: Reference[];
  topics: any[];
  journals: any[];
  usageCount: number;
  onRefresh: () => void;
}) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "");
  const active = useMemo(() => sections.find((s) => s.id === activeId) ?? sections[0], [sections, activeId]);
  const [content, setContent] = useState(active?.content ?? "");
  const [outline, setOutline] = useState(active?.outline ?? "");
  const [aiOutput, setAiOutput] = useState("");
  const [aiRunning, setAiRunning] = useState<string | null>(null);
  const [citeAllRunning, setCiteAllRunning] = useState(false);
  const [intensive, setIntensive] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ sectionId: string; content?: string; outline?: string } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useServerFn(updateSection);
  const runAction = useServerFn(runWritingAction);
  const citeAll = useServerFn(citeAllSections);
  const updateMode = useServerFn(updateProjectMode);
  const updateStatus = useServerFn(updateProjectStatus);
  const updateStyle = useServerFn(updateProjectCitationStyle);

  useEffect(() => {
    setContent(active?.content ?? "");
    setOutline(active?.outline ?? "");
    setAiOutput("");
  }, [active?.id]);

  async function flushSave() {
    if (!active || !pendingRef.current) return;
    const patch = pendingRef.current;
    pendingRef.current = null;
    setSaveState("saving");
    try {
      const { sectionId, ...changes } = patch;
      await update({ data: { id: sectionId, ...changes } });
      setSaveState("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("dirty");
    }
  }

  function scheduleSave(next: { content?: string; outline?: string }) {
    if (!active) return;
    pendingRef.current = { sectionId: active.id, ...(pendingRef.current?.sectionId === active.id ? pendingRef.current : {}), ...next };
    setSaveState("dirty");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flushSave();
    }, 800);
  }

  async function saveNow() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // ensure latest local state is queued
    if (active) pendingRef.current = { sectionId: active.id, content, outline };
    await flushSave();
  }

  async function run(action: (typeof WRITING_ACTIONS)[number]["key"]) {
    if (!active) return;
    setAiRunning(action);
    setAiOutput("");
    try {
      // flush first so AI sees fresh content
      pendingRef.current = { sectionId: active.id, ...(pendingRef.current?.sectionId === active.id ? pendingRef.current : {}), content, outline };
      await flushSave();
      const res = await runAction({
        data: { section_id: active.id, action, intensive: intensive && LIT_REVIEW_KEYS.has(active.key) },
      });
      setAiOutput(res.output);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setAiRunning(null);
      onRefresh();
    }
  }

  function insertOutput(mode: "replace" | "append" | "outline") {
    if (!aiOutput) return;
    if (mode === "outline") {
      const next = aiOutput;
      setOutline(next);
      scheduleSave({ outline: next });
    } else {
      const next = mode === "replace" ? aiOutput : (content + "\n\n" + aiOutput).trim();
      setContent(next);
      scheduleSave({ content: next });
    }
    toast.success("Inserted");
  }

  async function changeMode(mode: "low" | "advanced") {
    await updateMode({ data: { id: project.id, mode } });
    toast.success(`Mode: ${mode}`);
    onRefresh();
  }

  async function changeStatus(completed: boolean) {
    const status = completed ? "completed" : "draft";
    await updateStatus({ data: { id: project.id, status } });
    toast.success(`Status: ${status}`);
    onRefresh();
  }

  async function changeStyle(style: CitationStyle) {
    await saveNow();
    await updateStyle({ data: { id: project.id, citation_style: style } });
    toast.success(`Citation style: ${style}`);
    onRefresh();
  }

  const sectionWords = countWords(content);
  const projectWords = useMemo(
    () => sections.reduce((sum, s) => sum + countWords(s.id === active?.id ? content : s.content), 0),
    [sections, content, active?.id],
  );

  const isLitReview = active ? LIT_REVIEW_KEYS.has(active.key) : false;

  async function citeEverySection() {
    setCiteAllRunning(true);
    try {
      await saveNow();
      const res = await citeAll({ data: { project_id: project.id } });
      toast.success(`Cited ${res.updated} section${res.updated === 1 ? "" : "s"}`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Citation update failed");
    } finally {
      setCiteAllRunning(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-lg font-semibold truncate">{project.title}</div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                project.status === "completed"
                  ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {project.status === "completed" ? "Completed" : "Draft"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {project.doc_type} · {project.language_level}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {projectWords.toLocaleString()} words · AI calls: {usageCount}
          </div>
          <SaveIndicator state={saveState} onSaveNow={saveNow} />
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Style</Label>
            <Select value={project.citation_style} onValueChange={(v) => changeStyle(v as CitationStyle)}>
              <SelectTrigger className="h-8 w-[92px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CITATION_STYLES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground" htmlFor="status-toggle">Completed</Label>
            <Switch
              id="status-toggle"
              checked={project.status === "completed"}
              onCheckedChange={changeStatus}
            />
          </div>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={project.mode}
            onChange={(e) => changeMode(e.target.value as any)}
          >
            <option value="low">Low credit</option>
            <option value="advanced">Advanced</option>
          </select>
          <Link to="/projects/$id/export" params={{ id: project.id }}>
            <Button variant="outline" size="sm">
              <FileDown className="mr-2 h-4 w-4" /> Export
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* section list */}
        <div className="w-52 shrink-0 overflow-y-auto border-r border-border bg-card p-3">
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">Sections</div>
          {sections.map((s) => {
            const w = countWords(s.id === active?.id ? content : s.content);
            return (
              <button
                key={s.id}
                onClick={() => {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  void flushSave();
                  setActiveId(s.id);
                }}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  s.id === active?.id ? "bg-accent font-medium" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{w}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* editor */}
        <div className="flex-1 overflow-y-auto p-6">
          {active && (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">{active.title}</h2>
                <span className="text-xs text-muted-foreground">
                  {sectionWords.toLocaleString()} words in this section
                </span>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs">Outline</Label>
                  <VoiceCapture
                    compact
                    onTranscript={(t) => {
                      const next = (outline + " " + t).trim();
                      setOutline(next);
                      scheduleSave({ outline: next });
                    }}
                  />
                </div>
                <Textarea
                  rows={4}
                  value={outline}
                  onChange={(e) => {
                    setOutline(e.target.value);
                    scheduleSave({ outline: e.target.value });
                  }}
                  placeholder="Bullet outline for this section"
                />
              </div>
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs">Draft</Label>
                  <VoiceCapture
                    onTranscript={(t) => {
                      const next = (content + " " + t).trim();
                      setContent(next);
                      scheduleSave({ content: next });
                    }}
                  />
                </div>
                <Textarea
                  rows={20}
                  className="font-serif text-base leading-relaxed"
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    scheduleSave({ content: e.target.value });
                  }}
                  placeholder="Write here, dictate, or use AI actions on the right."
                />
              </div>
            </>
          )}
        </div>

        {/* right panel */}
        <div className="w-96 shrink-0 overflow-y-auto border-l border-border bg-card">
            <Tabs defaultValue="ai" className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start rounded-none">
              <TabsTrigger value="ai">AI</TabsTrigger>
              <TabsTrigger value="refs">Refs</TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
              <TabsTrigger value="topics">Topics</TabsTrigger>
              <TabsTrigger value="brainstorm">Ideas</TabsTrigger>
              <TabsTrigger value="visuals">Analysis</TabsTrigger>
              <TabsTrigger value="journals">Journals</TabsTrigger>
              <TabsTrigger value="library">Library</TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="p-4">
              {isLitReview && (
                <div className="mb-3 rounded-md border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label htmlFor="intensive" className="text-xs font-medium">Intensive citations</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Weaves multiple references from your library into every paragraph.
                      </p>
                    </div>
                    <Switch id="intensive" checked={intensive} onCheckedChange={setIntensive} />
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Uses your {refs.length} reference{refs.length === 1 ? "" : "s"} in {project.citation_style} style.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={citeAllRunning || refs.length === 0}
                  onClick={citeEverySection}
                  title={refs.length === 0 ? "Add references first" : "Cite every section with saved references"}
                >
                  {citeAllRunning ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Quote className="mr-2 h-3 w-3" />}
                  Cite all sections
                </Button>
                {WRITING_ACTIONS.map((a) => (
                  <Button
                    key={a.key}
                    size="sm"
                    variant="secondary"
                    disabled={aiRunning !== null || !active}
                    onClick={() => run(a.key)}
                  >
                    {aiRunning === a.key ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />}
                    {a.label}
                  </Button>
                ))}
              </div>
              {aiOutput && (
                <div className="mt-4 rounded-md border border-border bg-background p-3">
                  <div className="whitespace-pre-wrap text-sm">{aiOutput}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => insertOutput("append")}>Append</Button>
                    <Button size="sm" variant="outline" onClick={() => insertOutput("replace")}>Replace</Button>
                    <Button size="sm" variant="outline" onClick={() => insertOutput("outline")}>Set as outline</Button>
                  </div>
                </div>
              )}
              <p className="mt-6 text-xs text-muted-foreground">
                AI drafts are starting points. Verify data, methodology, and citations yourself.
              </p>
            </TabsContent>

            <TabsContent value="refs" className="p-4">
              <ReferencesPanel projectId={project.id} refs={refs} style={project.citation_style as CitationStyle} onRefresh={onRefresh} />
            </TabsContent>

            <TabsContent value="voice" className="p-4">
              <VoicePanel
                projectId={project.id}
                sectionId={active?.id}
                onApplyToNotes={(notes) => {
                  // append to current section outline as helpful notes
                  const next = (outline + (outline ? "\n\n" : "") + notes).trim();
                  setOutline(next);
                  scheduleSave({ outline: next });
                  toast.success("Applied to outline");
                }}
              />
            </TabsContent>

            <TabsContent value="topics" className="p-4">
              <TopicsPanel
                projectId={project.id}
                topics={topics}
                activeSectionContent={content}
                onRefresh={onRefresh}
              />
            </TabsContent>

            <TabsContent value="brainstorm" className="p-4">
              <BrainstormPanel projectId={project.id} onRefresh={onRefresh} />
            </TabsContent>

            <TabsContent value="visuals" className="p-4">
              <VisualsPanel
                projectId={project.id}
                sectionId={active?.id}
                sectionSource={[outline, content].filter(Boolean).join("\n\n")}
                onInsert={(markdown: string) => {
                  const next = (content + "\n\n" + markdown).trim();
                  setContent(next);
                  scheduleSave({ content: next });
                  toast.success("Visual inserted into section");
                }}
              />
            </TabsContent>

            <TabsContent value="journals" className="p-4">
              <JournalsPanel projectId={project.id} journals={journals} onRefresh={onRefresh} />
            </TabsContent>

            <TabsContent value="library" className="p-4">
              <LibraryPanel
                projectId={project.id}
                sections={sections}
                activeSectionId={active?.id}
                onInsertMarkdown={(md: string) => {
                  const next = (content + "\n\n" + md).trim();
                  setContent(next);
                  scheduleSave({ content: next });
                  toast.success("Inserted into section");
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ state, onSaveNow }: { state: SaveState; onSaveNow: () => void }) {
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "dirty"
          ? "Unsaved"
          : "Saved";
  const icon =
    state === "saving" ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : state === "dirty" ? (
      <Save className="h-3 w-3" />
    ) : (
      <Check className="h-3 w-3 text-green-600" />
    );
  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
        {icon} {label}
      </span>
      <Button size="sm" variant="outline" onClick={onSaveNow} disabled={state === "saving"}>
        Save now
      </Button>
    </div>
  );
}

function ReferencesPanel({
  projectId,
  refs,
  style,
  onRefresh,
}: {
  projectId: string;
  refs: Reference[];
  style: CitationStyle;
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [showBib, setShowBib] = useState(false);
  const [bib, setBib] = useState("");
  const add = useServerFn(addReference);
  const del = useServerFn(deleteReference);
  const imp = useServerFn(importBibtex);

  const [f, setF] = useState({
    cite_key: "",
    authors: "",
    year: "",
    title: "",
    container: "",
    publisher: "",
    doi: "",
    url: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await add({
        data: {
          project_id: projectId,
          cite_key: f.cite_key || genKey(f.authors, f.year),
          authors: f.authors,
          title: f.title,
          year: f.year ? parseInt(f.year, 10) : null,
          container: f.container || null,
          publisher: f.publisher || null,
          doi: f.doi || null,
          url: f.url || null,
        },
      });
      toast.success("Reference added");
      setShowForm(false);
      setF({ cite_key: "", authors: "", year: "", title: "", container: "", publisher: "", doi: "", url: "" });
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function importBib() {
    try {
      const r = await imp({ data: { project_id: projectId, bibtex: bib } });
      toast.success(`Imported ${r.inserted} references`);
      setBib("");
      setShowBib(false);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setShowForm((s) => !s)}>
          Add reference
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowBib((s) => !s)}>
          Import BibTeX
        </Button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
          <Input placeholder="Authors (Last, F.; Last, F.)" value={f.authors} onChange={(e) => setF({ ...f, authors: e.target.value })} required />
          <Input placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Year" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
            <Input placeholder="Cite key" value={f.cite_key} onChange={(e) => setF({ ...f, cite_key: e.target.value })} />
          </div>
          <Input placeholder="Journal / Container" value={f.container} onChange={(e) => setF({ ...f, container: e.target.value })} />
          <Input placeholder="Publisher" value={f.publisher} onChange={(e) => setF({ ...f, publisher: e.target.value })} />
          <Input placeholder="DOI" value={f.doi} onChange={(e) => setF({ ...f, doi: e.target.value })} />
          <Input placeholder="URL" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <Button size="sm" type="submit">Save</Button>
        </form>
      )}

      {showBib && (
        <div className="mt-3 space-y-2 rounded-md border border-border p-3">
          <Textarea rows={6} value={bib} onChange={(e) => setBib(e.target.value)} placeholder="Paste BibTeX entries here" />
          <Button size="sm" onClick={importBib}>Import</Button>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {refs.map((r) => (
          <div key={r.id} className="rounded-md border border-border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-medium">{r.title}</div>
                <div className="text-muted-foreground">{r.authors}{r.year ? ` (${r.year})` : ""}</div>
                <div className="mt-1 text-muted-foreground">In-text: {inTextCitation(r, style)}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={async () => { await del({ data: { id: r.id } }); onRefresh(); }}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {refs.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium">Reference list ({style})</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{formatReferenceList(refs, style)}</pre>
        </details>
      )}
    </div>
  );
}

function genKey(authors: string, year: string): string {
  const last = (authors.split(/[,;]|\s+and\s+/)[0] ?? "ref").split(/\s+/).pop() ?? "ref";
  return `${last.toLowerCase()}${year || ""}`;
}

function VoicePanel({
  projectId,
  sectionId,
  onApplyToNotes,
}: {
  projectId: string;
  sectionId?: string;
  onApplyToNotes: (notes: string) => void;
}) {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"ask" | "extract">("ask");
  const [extracted, setExtracted] = useState<null | {
    topic: string;
    objectives: string[];
    research_questions: string[];
    methodology: string;
    keywords: string[];
    notes: string;
  }>(null);
  const run = useServerFn(runVoiceCommand);
  const save = useServerFn(saveTranscript);
  const extract = useServerFn(extractFromNarration);

  async function submit() {
    if (!command.trim()) return;
    setRunning(true);
    setExtracted(null);
    setOutput("");
    try {
      await save({ data: { project_id: projectId, section_id: sectionId, text: command, kind: "command" } });
      if (mode === "ask") {
        const r = await run({ data: { project_id: projectId, section_id: sectionId, command } });
        setOutput(r.output);
      } else {
        const r = await extract({ data: { project_id: projectId, transcript: command } });
        setExtracted(r);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  function applyExtracted() {
    if (!extracted) return;
    const parts: string[] = [];
    if (extracted.topic) parts.push(`Topic: ${extracted.topic}`);
    if (extracted.objectives.length) parts.push(`Objectives:\n- ${extracted.objectives.join("\n- ")}`);
    if (extracted.research_questions.length) parts.push(`Research questions:\n- ${extracted.research_questions.join("\n- ")}`);
    if (extracted.methodology) parts.push(`Methodology: ${extracted.methodology}`);
    if (extracted.keywords.length) parts.push(`Keywords: ${extracted.keywords.join(", ")}`);
    if (extracted.notes) parts.push(`Notes: ${extracted.notes}`);
    onApplyToNotes(parts.join("\n\n"));
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <button
          className={`rounded-md border px-2 py-1 ${mode === "ask" ? "bg-accent" : "bg-background"}`}
          onClick={() => setMode("ask")}
        >
          Ask
        </button>
        <button
          className={`rounded-md border px-2 py-1 ${mode === "extract" ? "bg-accent" : "bg-background"}`}
          onClick={() => setMode("extract")}
        >
          Extract to fields
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "ask"
          ? 'Dictate or type a command like "Critique my methodology".'
          : "Describe your study — the AI pulls out topic, objectives, RQs, methodology, and keywords."}
      </p>
      <Textarea rows={4} className="mt-2" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ask the assistant…" />
      <div className="mt-2 flex gap-2">
        <VoiceCapture onTranscript={(t) => setCommand((c) => (c + " " + t).trim())} />
        <Button size="sm" onClick={submit} disabled={running}>
          {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />} Send
        </Button>
      </div>
      {output && (
        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <div className="whitespace-pre-wrap text-sm">{output}</div>
        </div>
      )}
      {extracted && (
        <div className="mt-4 space-y-2 rounded-md border border-border bg-background p-3 text-xs">
          {extracted.topic && <div><b>Topic:</b> {extracted.topic}</div>}
          {extracted.objectives.length > 0 && (
            <div>
              <b>Objectives:</b>
              <ul className="ml-4 list-disc">{extracted.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </div>
          )}
          {extracted.research_questions.length > 0 && (
            <div>
              <b>Research questions:</b>
              <ul className="ml-4 list-disc">{extracted.research_questions.map((o, i) => <li key={i}>{o}</li>)}</ul>
            </div>
          )}
          {extracted.methodology && <div><b>Methodology:</b> {extracted.methodology}</div>}
          {extracted.keywords.length > 0 && <div><b>Keywords:</b> {extracted.keywords.join(", ")}</div>}
          {extracted.notes && <div><b>Notes:</b> {extracted.notes}</div>}
          <Button size="sm" onClick={applyExtracted}>Apply to section outline</Button>
        </div>
      )}
    </div>
  );
}

function TopicsPanel({
  projectId,
  topics,
  activeSectionContent,
  onRefresh,
}: {
  projectId: string;
  topics: any[];
  activeSectionContent: string;
  onRefresh: () => void;
}) {
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extract, setExtract] = useState<null | {
    implicit_topic: string;
    better_statements: string[];
    subtopics: string[];
  }>(null);
  const gen = useServerFn(generateTopics);
  const pin = useServerFn(togglePinTopic);
  const del = useServerFn(deleteTopic);
  const extractFn = useServerFn(extractTopicFromText);
  const insert = useServerFn(insertTopics);

  async function generate() {
    if (!brief.trim()) return;
    setRunning(true);
    try {
      await gen({ data: { project_id: projectId, brief } });
      setBrief("");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  async function runExtract(text: string) {
    if (!text.trim() || text.trim().length < 10) {
      toast.error("Need more text to extract a topic");
      return;
    }
    setExtracting(true);
    setExtract(null);
    try {
      const r = await extractFn({ data: { project_id: projectId, text } });
      setExtract(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setExtracting(false);
    }
  }

  async function pinStatement(title: string) {
    try {
      await insert({ data: { project_id: projectId, items: [{ title, description: extract?.implicit_topic ?? "" }] } });
      toast.success("Pinned as topic");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <Textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Describe area of interest / keywords" />
      <div className="mt-2 flex flex-wrap gap-2">
        <VoiceCapture onTranscript={(t) => setBrief((b) => (b + " " + t).trim())} />
        <Button size="sm" onClick={generate} disabled={running}>
          {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />} Suggest topics
        </Button>
      </div>

      <div className="mt-4 rounded-md border border-border p-3">
        <div className="text-xs font-medium">Topic extraction</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Infer the underlying topic from your current section or a fresh narration.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => runExtract(activeSectionContent)} disabled={extracting}>
            {extracting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null} From current section
          </Button>
          <VoiceCapture label="From narration" onTranscript={(t) => runExtract(t)} />
        </div>
        {extract && (
          <div className="mt-3 space-y-2 text-xs">
            {extract.implicit_topic && <div><b>Implicit topic:</b> {extract.implicit_topic}</div>}
            {extract.better_statements.length > 0 && (
              <div>
                <div className="font-medium">Sharper statements:</div>
                <ul className="mt-1 space-y-1">
                  {extract.better_statements.map((s, i) => (
                    <li key={i} className="flex items-start justify-between gap-2 rounded-md bg-muted/40 p-1.5">
                      <span>{s}</span>
                      <Button size="icon" variant="ghost" onClick={() => pinStatement(s)}>
                        <Pin className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {extract.subtopics.length > 0 && (
              <div>
                <div className="font-medium">Subtopics / angles:</div>
                <ul className="ml-4 list-disc">{extract.subtopics.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {topics.map((t) => (
          <div key={t.id} className="rounded-md border border-border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-medium">{t.title}</div>
                <div className="mt-1 text-muted-foreground">{t.description}</div>
                {t.research_questions && <div className="mt-1"><b>RQ:</b> {t.research_questions}</div>}
                {t.trend_note && <div className="mt-1 text-muted-foreground">{t.trend_note}</div>}
              </div>
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" onClick={async () => { await pin({ data: { id: t.id, pinned: !t.pinned } }); onRefresh(); }}>
                  <Pin className={`h-3 w-3 ${t.pinned ? "fill-current" : ""}`} />
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => { await del({ data: { id: t.id } }); onRefresh(); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrainstormPanel({ projectId, onRefresh }: { projectId: string; onRefresh: () => void }) {
  const [area, setArea] = useState("");
  const [keywords, setKeywords] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<null | { ideas: string[]; problems: string[]; questions: string[] }>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const brain = useServerFn(brainstormIdeas);
  const insert = useServerFn(insertTopics);

  async function run() {
    if (!area.trim()) return;
    setRunning(true);
    setResult(null);
    setSelected(new Set());
    try {
      const r = await brain({ data: { project_id: projectId, area, keywords } });
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  function toggle(item: string) {
    const next = new Set(selected);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    setSelected(next);
  }

  async function saveSelected() {
    if (selected.size === 0) {
      toast.error("Pick at least one item");
      return;
    }
    try {
      await insert({
        data: {
          project_id: projectId,
          items: Array.from(selected).map((title) => ({ title: title.slice(0, 300) })),
        },
      });
      toast.success(`Saved ${selected.size} as topics`);
      setSelected(new Set());
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  function renderList(title: string, items: string[]) {
    return (
      <div className="mt-3">
        <div className="text-xs font-medium">{title}</div>
        <ul className="mt-1 space-y-1">
          {items.map((it, i) => (
            <li key={`${title}-${i}`} className="flex items-start gap-2 rounded-md border border-border p-1.5 text-xs">
              <input
                type="checkbox"
                checked={selected.has(it)}
                onChange={() => toggle(it)}
                className="mt-0.5"
              />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-xs">Broad area of research</Label>
      <Textarea rows={2} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. AI in medical diagnosis" />
      <div className="mt-2">
        <Label className="text-xs">Keywords (optional)</Label>
        <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. radiology, deep learning, ethics" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <VoiceCapture onTranscript={(t) => setArea((a) => (a + " " + t).trim())} />
        <VoiceCapture label="Dictate keywords" onTranscript={(t) => setKeywords((k) => (k + " " + t).trim())} />
        <Button size="sm" onClick={run} disabled={running}>
          {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />} Brainstorm
        </Button>
      </div>

      {result && (
        <>
          {renderList("Ideas", result.ideas)}
          {renderList("Research problems", result.problems)}
          {renderList("Research questions", result.questions)}
          <Button size="sm" className="mt-3" onClick={saveSelected}>
            Save selected as topics ({selected.size})
          </Button>
        </>
      )}
    </div>
  );
}

function VisualsPanel({
  projectId,
  sectionId,
  sectionSource,
  onInsert,
}: {
  projectId: string;
  sectionId?: string;
  sectionSource: string;
  onInsert: (markdown: string) => void;
}) {
  const [mode, setMode] = useState<"text" | "data">("text");
  return (
    <div>
      <div className="mb-3 inline-flex rounded-md border border-border bg-muted p-0.5 text-xs">
        <button
          className={`rounded px-3 py-1 ${mode === "text" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          onClick={() => setMode("text")}
        >
          Text
        </button>
        <button
          className={`rounded px-3 py-1 ${mode === "data" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          onClick={() => setMode("data")}
        >
          Data
        </button>
      </div>
      {mode === "text" ? (
        <TextVisualsSection
          projectId={projectId}
          sectionId={sectionId}
          sectionSource={sectionSource}
          onInsert={onInsert}
        />
      ) : (
        <DataAnalysisSection
          projectId={projectId}
          sectionId={sectionId}
          onInsert={onInsert}
        />
      )}
      <AttachedVisualsList projectId={projectId} />
    </div>
  );
}

function TextVisualsSection({
  projectId,
  sectionId,
  sectionSource,
  onInsert,
}: {
  projectId: string;
  sectionId?: string;
  sectionSource: string;
  onInsert: (markdown: string) => void;
}) {
  const [kind, setKind] = useState<GeneratedVisual["kind"]>("table");
  const [prompt, setPrompt] = useState("");
  const [customSource, setCustomSource] = useState("");
  const [running, setRunning] = useState(false);
  const [visual, setVisual] = useState<GeneratedVisual | null>(null);
  const gen = useServerFn(generateVisual);
  const attach = useServerFn(attachVisual);
  const qc = useQueryClient();

  async function run() {
    setRunning(true);
    setVisual(null);
    try {
      const result = await gen({
        data: {
          project_id: projectId,
          kind,
          source: customSource || sectionSource,
          prompt,
          ...(sectionId ? { section_id: sectionId } : {}),
        },
      });
      setVisual(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Visual generation failed");
    } finally {
      setRunning(false);
    }
  }

  async function attachThis() {
    if (!visual) return;
    try {
      await attach({
        data: {
          project_id: projectId,
          section_id: sectionId ?? null,
          kind: visual.kind,
          title: visual.title,
          caption: visual.caption,
          payload: visual,
        },
      });
      toast.success("Attached to export");
      qc.invalidateQueries({ queryKey: ["visuals", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Attach failed");
    }
  }

  const kinds: Array<{ value: GeneratedVisual["kind"]; label: string }> = [
    { value: "table", label: "Table" },
    { value: "chart", label: "Graph/chart" },
    { value: "concept", label: "Concept map" },
    { value: "timeline", label: "Timeline" },
    { value: "figure", label: "Figure summary" },
  ];

  return (
    <div>
      <Label className="text-xs">Visual type</Label>
      <Select value={kind} onValueChange={(v) => setKind(v as GeneratedVisual["kind"])}>
        <SelectTrigger className="mt-1 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kinds.map((k) => (
            <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        rows={3}
        className="mt-3"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Optional instruction, e.g. compare themes, summarize methodology, or chart reported values"
      />
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium">Use custom source text</summary>
        <Textarea
          rows={5}
          className="mt-2"
          value={customSource}
          onChange={(e) => setCustomSource(e.target.value)}
          placeholder="Leave empty to use the current section."
        />
      </details>
      <div className="mt-3 flex flex-wrap gap-2">
        <VoiceCapture label="Dictate instruction" onTranscript={(t) => setPrompt((p) => (p + " " + t).trim())} />
        <Button size="sm" onClick={run} disabled={running}>
          {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Table2 className="mr-2 h-3 w-3" />}
          Generate preview
        </Button>
      </div>

      {visual && (
        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <div className="text-sm font-medium">{visual.title}</div>
          {visual.caption && <div className="mt-1 text-xs text-muted-foreground">{visual.caption}</div>}
          <VisualPreview visual={visual} />
          <Textarea rows={7} className="mt-3 font-mono text-xs" value={visual.markdown} readOnly />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onInsert(visual.markdown)}>Insert into section</Button>
            <Button size="sm" variant="outline" onClick={attachThis}>Attach to export</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DataAnalysisSection({
  projectId,
  sectionId,
  onInsert,
}: {
  projectId: string;
  sectionId?: string;
  onInsert: (markdown: string) => void;
}) {
  const [source, setSource] = useState<"section" | "paste" | "upload">("paste");
  const [csv, setCsv] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedUploadId, setSelectedUploadId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const runData = useServerFn(analyzeDataset);
  const runText = useServerFn(analyzeSectionText);
  const attach = useServerFn(attachVisual);
  const listUploadsFn = useServerFn(listUploads);
  const createUrl = useServerFn(createUploadUrl);
  const recordFn = useServerFn(recordUpload);
  const qc = useQueryClient();

  const uploadsQ = useQuery({
    queryKey: ["uploads", projectId],
    queryFn: () => listUploadsFn({ data: { project_id: projectId } }),
  });
  const dataFiles = (uploadsQ.data ?? []).filter((u: any) => /\.(csv|xlsx?|tsv)$/i.test(u.name));

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const { path, signedUrl } = await createUrl({ data: { project_id: projectId, name: file.name } });
      const put = await fetch(signedUrl, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error("Upload failed");
      await recordFn({ data: { project_id: projectId, path, name: file.name, mime: file.type || "text/csv", size: file.size } });
      await qc.invalidateQueries({ queryKey: ["uploads", projectId] });
      toast.success("Data file uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function analyze() {
    setRunning(true);
    setResult(null);
    try {
      let r: AnalysisResult;
      if (source === "section") {
        if (!sectionId) throw new Error("Open a section first");
        r = await runText({ data: { project_id: projectId, section_id: sectionId, prompt } });
      } else if (source === "paste") {
        if (!csv.trim()) throw new Error("Paste some CSV first");
        r = await runData({ data: { project_id: projectId, inline_csv: csv, prompt, ...(sectionId ? { section_id: sectionId } : {}) } });
      } else {
        if (!selectedUploadId) throw new Error("Select an uploaded file");
        r = await runData({ data: { project_id: projectId, upload_id: selectedUploadId, prompt, ...(sectionId ? { section_id: sectionId } : {}) } });
      }
      setResult(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
    }
  }

  async function attachChart(chart: RecommendedChart) {
    if (!result) return;
    try {
      await attach({
        data: {
          project_id: projectId,
          section_id: sectionId ?? null,
          kind: `chart:${chart.type}`,
          title: chart.title,
          caption: chart.rationale,
          payload: {
            summary: result.summary,
            recommendedCharts: [chart],
            citations: result.citations,
          },
        },
      });
      toast.success("Chart attached to export");
      qc.invalidateQueries({ queryKey: ["visuals", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Attach failed");
    }
  }

  async function attachSummary() {
    if (!result) return;
    try {
      await attach({
        data: {
          project_id: projectId,
          section_id: sectionId ?? null,
          kind: "analysis",
          title: result.table.title || "Data analysis",
          caption: result.summary.slice(0, 300),
          payload: {
            summary: result.summary,
            keyFindings: result.keyFindings,
            table: result.table,
            recommendedCharts: result.recommendedCharts,
            citations: result.citations,
          },
        },
      });
      toast.success("Analysis attached to export");
      qc.invalidateQueries({ queryKey: ["visuals", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Attach failed");
    }
  }

  function tableToMarkdown(t: AnalysisResult["table"]): string {
    if (!t.columns.length || !t.rows.length) return "";
    const lines = [`**${t.title}**`, "", `| ${t.columns.join(" | ")} |`, `| ${t.columns.map(() => "---").join(" | ")} |`];
    for (const r of t.rows) lines.push(`| ${t.columns.map((_, i) => r[i] ?? "").join(" | ")} |`);
    return lines.join("\n");
  }

  function summaryMarkdown(): string {
    if (!result) return "";
    const parts: string[] = [];
    if (result.summary) parts.push(result.summary);
    if (result.keyFindings.length) parts.push(result.keyFindings.map((f) => `- ${f}`).join("\n"));
    const t = tableToMarkdown(result.table);
    if (t) parts.push(t);
    if (result.citations.length) parts.push(`Cited: ${result.citations.join("; ")}`);
    return parts.join("\n\n");
  }

  return (
    <div>
      <Label className="text-xs">Source</Label>
      <div className="mt-1 flex flex-wrap gap-1">
        {(
          [
            { key: "paste", label: "Paste CSV" },
            { key: "upload", label: "Uploaded file" },
            { key: "section", label: "Section text" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSource(opt.key)}
            className={`rounded-md border px-2 py-1 text-xs ${source === opt.key ? "border-primary bg-primary/10" : "border-border bg-background"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {source === "paste" && (
        <Textarea
          rows={5}
          className="mt-3 font-mono text-xs"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"Group,Pre,Post\nControl,12,14\nTreatment,11,19"}
        />
      )}

      {source === "upload" && (
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-xs">
            <Upload className="h-3 w-3" />
            {uploading ? "Uploading…" : "Upload CSV / XLSX"}
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {dataFiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No data files yet. Upload a .csv or .xlsx above.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {dataFiles.map((f: any) => (
                <li key={f.id}>
                  <button
                    onClick={() => setSelectedUploadId(f.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1 text-left ${selectedUploadId === f.id ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{Math.round((f.size ?? 0) / 1024)} KB</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {source === "section" && (
        <p className="mt-3 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
          Uses the current section's outline + draft. Best for extracting findings from a written Results section.
        </p>
      )}

      <Textarea
        rows={2}
        className="mt-3"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Optional: e.g. Compare pre/post means by group, suggest a bar chart"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <VoiceCapture label="Dictate analysis" onTranscript={(t) => setPrompt((p) => (p + " " + t).trim())} />
        <Button size="sm" onClick={analyze} disabled={running}>
          {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <BarChart3 className="mr-2 h-3 w-3" />}
          Summarize & propose visuals
        </Button>
      </div>

      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border bg-background p-3">
            <div className="text-sm font-medium">Summary</div>
            {result.summary && <p className="mt-1 whitespace-pre-wrap text-xs">{result.summary}</p>}
            {result.keyFindings.length > 0 && (
              <ul className="mt-2 ml-4 list-disc space-y-1 text-xs">
                {result.keyFindings.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
            {result.citations.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">Cited: {result.citations.join("; ")}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onInsert(summaryMarkdown())} disabled={!sectionId}>
                Insert into section
              </Button>
              <Button size="sm" variant="outline" onClick={attachSummary}>
                Attach analysis to export
              </Button>
            </div>
          </div>

          {result.table.columns.length > 0 && result.table.rows.length > 0 && (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="text-sm font-medium">{result.table.title}</div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted">
                    <tr>{result.table.columns.map((c) => <th key={c} className="p-2 font-medium">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.table.rows.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {result.table.columns.map((_, j) => <td key={j} className="p-2 align-top">{r[j] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onInsert(tableToMarkdown(result.table))} disabled={!sectionId}>
                Insert table
              </Button>
            </div>
          )}

          {result.recommendedCharts.map((c, i) => (
            <div key={i} className="rounded-md border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{c.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.type} · {c.x} → {c.y}
                  </div>
                </div>
              </div>
              {c.rationale && <p className="mt-1 text-xs text-muted-foreground">{c.rationale}</p>}
              <DatasetChart chart={c} />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => attachChart(c)}>
                  Attach to export
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachedVisualsList({ projectId }: { projectId: string }) {
  const list = useServerFn(listVisuals);
  const del = useServerFn(deleteVisual);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["visuals", projectId], queryFn: () => list({ data: { project_id: projectId } }) });
  const items = (q.data ?? []) as AttachedVisual[];
  if (!items.length) return null;
  return (
    <div className="mt-6 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium">Attached to export ({items.length})</div>
      </div>
      <ul className="space-y-1 text-xs">
        {items.map((v) => (
          <li key={v.id} className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1">
            <div className="min-w-0">
              <div className="truncate">{v.title}</div>
              <div className="text-[10px] text-muted-foreground">{v.kind}</div>
            </div>
            <button
              className="text-muted-foreground hover:text-destructive"
              onClick={async () => {
                await del({ data: { id: v.id } });
                qc.invalidateQueries({ queryKey: ["visuals", projectId] });
              }}
              title="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DatasetChart({ chart }: { chart: RecommendedChart }) {
  const data = chart.data.length ? chart.data : [];
  if (!data.length) {
    return <div className="mt-3 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">No preview data.</div>;
  }
  const pieColors = ["#6366f1", "#22c55e", "#eab308", "#ef4444", "#06b6d4", "#a855f7", "#f97316", "#3b82f6"];
  return (
    <div className="mt-3 h-56 rounded-md border border-border p-2">
      <ResponsiveContainer width="100%" height="100%">
        {chart.type === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 36, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={52} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot />
          </LineChart>
        ) : chart.type === "pie" ? (
          <PieChart>
            <Tooltip />
            <Pie data={data} dataKey="value" nameKey="label" outerRadius={80} label={{ fontSize: 10 }}>
              {data.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
            </Pie>
          </PieChart>
        ) : chart.type === "scatter" ? (
          <ScatterChart margin={{ top: 8, right: 8, bottom: 36, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" name={chart.x} tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} height={52} />
            <YAxis dataKey="value" name={chart.y} tick={{ fontSize: 10 }} />
            <ZAxis range={[60, 60]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={data} fill="hsl(var(--primary))" />
          </ScatterChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 36, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={52} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function VisualPreview({ visual }: { visual: GeneratedVisual }) {
  if (visual.chart.length > 0) {
    return (
      <div className="mt-3 h-52 rounded-md border border-border p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={visual.chart} margin={{ top: 8, right: 8, bottom: 36, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={52} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (visual.columns.length && visual.rows.length) {
    return (
      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted">
            <tr>{visual.columns.map((c) => <th key={c} className="p-2 font-medium">{c}</th>)}</tr>
          </thead>
          <tbody>
            {visual.rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {visual.columns.map((_, j) => <td key={j} className="p-2 align-top">{row[j]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (visual.bullets.length) {
    return <ul className="mt-3 ml-4 list-disc space-y-1 text-xs">{visual.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>;
  }
  return <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{visual.markdown}</pre>;
}


function JournalsPanel({ projectId, journals, onRefresh }: { projectId: string; journals: any[]; onRefresh: () => void }) {
  const [topic, setTopic] = useState("");
  const [wordCount, setWordCount] = useState("");
  const [oa, setOa] = useState<"any" | "prefer" | "required">("any");
  const [impact, setImpact] = useState<"any" | "high" | "mid" | "practitioner">("any");
  const [running, setRunning] = useState(false);
  const gen = useServerFn(generateJournals);
  const pin = useServerFn(togglePinJournal);
  const del = useServerFn(deleteJournal);

  async function generate() {
    if (!topic.trim()) return;
    setRunning(true);
    try {
      await gen({
        data: {
          project_id: projectId,
          topic,
          word_count: wordCount ? parseInt(wordCount, 10) : undefined,
          open_access: oa,
          impact,
        },
      });
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <Textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Manuscript title / abstract / keywords" />
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Input placeholder="Words" value={wordCount} onChange={(e) => setWordCount(e.target.value)} />
        <select className="rounded-md border border-input bg-background px-2 text-xs" value={oa} onChange={(e) => setOa(e.target.value as any)}>
          <option value="any">OA: any</option>
          <option value="prefer">OA preferred</option>
          <option value="required">OA required</option>
        </select>
        <select className="rounded-md border border-input bg-background px-2 text-xs" value={impact} onChange={(e) => setImpact(e.target.value as any)}>
          <option value="any">Impact: any</option>
          <option value="high">High</option>
          <option value="mid">Mid-tier</option>
          <option value="practitioner">Practitioner</option>
        </select>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <VoiceCapture onTranscript={(t) => setTopic((s) => (s + " " + t).trim())} />
        <Button size="sm" onClick={generate} disabled={running}>
          {running ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Sparkles className="mr-2 h-3 w-3" />} Suggest journals
        </Button>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Suggestions are AI-generated. Verify scope, indexing (e.g. Scopus), and requirements on the venue's website.
      </p>
      <div className="mt-4 space-y-3">
        {journals.map((j) => (
          <div key={j.id} className="rounded-md border border-border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-medium">{j.name}</div>
                {j.scope && <div className="mt-1 text-muted-foreground">{j.scope}</div>}
                {j.audience && <div className="mt-1"><b>Audience:</b> {j.audience}</div>}
                {j.requirements && <div className="mt-1"><b>Requirements:</b> {j.requirements}</div>}
                {j.open_access && <div className="mt-1"><b>OA:</b> {j.open_access}</div>}
                {j.notes && <div className="mt-1 text-muted-foreground">{j.notes}</div>}
                <a
                  href={j.url && /^https?:\/\//.test(j.url) ? j.url : `https://scholar.google.com/scholar?q=${encodeURIComponent(j.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Verify on journal's website
                </a>
              </div>
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" onClick={async () => { await pin({ data: { id: j.id, pinned: !j.pinned } }); onRefresh(); }}>
                  <Pin className={`h-3 w-3 ${j.pinned ? "fill-current" : ""}`} />
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => { await del({ data: { id: j.id } }); onRefresh(); }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadRow {
  id: string;
  project_id: string;
  section_id: string | null;
  path: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  signed_url: string | null;
}

function LibraryPanel({
  projectId,
  sections,
  activeSectionId,
  onInsertMarkdown,
}: {
  projectId: string;
  sections: Section[];
  activeSectionId?: string;
  onInsertMarkdown: (md: string) => void;
}) {
  const list = useServerFn(listUploads);
  const sign = useServerFn(createUploadUrl);
  const record = useServerFn(recordUpload);
  const attach = useServerFn(attachUpload);
  const del = useServerFn(deleteUpload);
  const [items, setItems] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const rows = (await list({ data: { project_id: projectId } })) as UploadRow[];
      setItems(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    const t = toast.loading(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      for (const file of Array.from(files)) {
        const { path, token } = await sign({
          data: { project_id: projectId, name: file.name },
        });
        const { error } = await supabase.storage
          .from("project-uploads")
          .uploadToSignedUrl(path, token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        await record({
          data: {
            project_id: projectId,
            path,
            name: file.name,
            mime: file.type || "application/octet-stream",
            size: file.size,
            section_id: activeSectionId ?? null,
          },
        });
      }
      toast.success("Uploaded", { id: t });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed", { id: t });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    await handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground"
      >
        <Upload className="h-5 w-5" />
        <div>Drag & drop files here, or</div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Upload className="mr-2 h-3 w-3" />}
            Upload files
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="text-[10px]">Images, PDFs, notes — max ~20MB each.</div>
      </div>

      {loading ? (
        <div className="mt-4 text-xs text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="mt-4 text-xs text-muted-foreground">No uploads yet.</div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {items.map((u) => (
            <div key={u.id} className="rounded-md border border-border bg-background p-2 text-xs">
              {u.kind === "image" && u.signed_url ? (
                <a href={u.signed_url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={u.signed_url}
                    alt={u.name}
                    className="mb-2 h-24 w-full rounded object-cover"
                  />
                </a>
              ) : (
                <div className="mb-2 flex h-24 items-center justify-center rounded bg-muted">
                  <Paperclip className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="truncate font-medium" title={u.name}>{u.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {u.mime} · {fmtSize(u.size)}
              </div>
              <div className="mt-1 text-[10px]">
                <b>Section:</b>{" "}
                <select
                  className="rounded border border-input bg-background px-1 py-0.5 text-[10px]"
                  value={u.section_id ?? ""}
                  onChange={async (e) => {
                    const next = e.target.value || null;
                    await attach({ data: { id: u.id, section_id: next } });
                    await refresh();
                  }}
                >
                  <option value="">— none —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => {
                    if (!u.signed_url) {
                      toast.error("No link available");
                      return;
                    }
                    const md =
                      u.kind === "image"
                        ? `![${u.name}](${u.signed_url})`
                        : `[${u.name}](${u.signed_url})`;
                    onInsertMarkdown(md);
                  }}
                >
                  <Link2 className="mr-1 h-3 w-3" /> Insert
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={async () => {
                    if (!u.signed_url) return;
                    await navigator.clipboard.writeText(u.signed_url);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={async () => {
                    if (!confirm(`Delete "${u.name}"?`)) return;
                    await del({ data: { id: u.id } });
                    await refresh();
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground">
        Uploads are private to you. Insert links to reference an image or file inside a section.
      </p>
    </div>
  );
}
