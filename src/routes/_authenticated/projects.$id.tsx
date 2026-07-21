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
import { runWritingAction } from "@/lib/ai/writing.functions";
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
import { addReference, deleteReference, importBibtex } from "@/lib/refs.functions";
import { formatReferenceList, inTextCitation, type Reference } from "@/lib/citations";
import { CITATION_STYLES, type CitationStyle } from "@/lib/doc-templates";
import { countWords } from "@/lib/text";
import { Pin, Trash2, Loader2, Sparkles, FileDown, Save, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id")({
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
  const [intensive, setIntensive] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ content?: string; outline?: string } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useServerFn(updateSection);
  const runAction = useServerFn(runWritingAction);
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
      await update({ data: { id: active.id, ...patch } });
      setSaveState("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("dirty");
    }
  }

  function scheduleSave(next: { content?: string; outline?: string }) {
    if (!active) return;
    pendingRef.current = { ...(pendingRef.current ?? {}), ...next };
    setSaveState("dirty");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flushSave();
    }, 800);
  }

  async function saveNow() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // ensure latest local state is queued
    pendingRef.current = { ...(pendingRef.current ?? {}), content, outline };
    await flushSave();
  }

  async function run(action: (typeof WRITING_ACTIONS)[number]["key"]) {
    if (!active) return;
    setAiRunning(action);
    setAiOutput("");
    try {
      // flush first so AI sees fresh content
      pendingRef.current = { ...(pendingRef.current ?? {}), content, outline };
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
                onClick={() => setActiveId(s.id)}
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
            <TabsList className="grid w-full grid-cols-6 rounded-none">
              <TabsTrigger value="ai">AI</TabsTrigger>
              <TabsTrigger value="refs">Refs</TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
              <TabsTrigger value="topics">Topics</TabsTrigger>
              <TabsTrigger value="brainstorm">Ideas</TabsTrigger>
              <TabsTrigger value="journals">Journals</TabsTrigger>
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

            <TabsContent value="journals" className="p-4">
              <JournalsPanel projectId={project.id} journals={journals} onRefresh={onRefresh} />
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
