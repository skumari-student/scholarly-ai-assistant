import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chatJSON, pickModel } from "./ai-gateway.server";

export interface JournalHit {
  issn: string;
  title: string;
  publisher: string | null;
  homepage: string | null;
  scopus: boolean;
  doaj: boolean;
  pubmed: boolean;
  openaccess: boolean;
  apc: number | null;
  impact: number | null; // 2-yr mean citedness proxy (OpenAlex)
  scope: string | null;
  fit_score?: number;
  fit_why?: string;
  sources: string[];
}

export interface JournalProfile extends JournalHit {
  recent_articles: Array<{ title: string; year?: number; doi?: string }>;
  submission_url?: string;
}

// ---------- OpenAlex ----------
async function openAlexSearch(query: string): Promise<JournalHit[]> {
  const url = `https://api.openalex.org/sources?search=${encodeURIComponent(query)}&per-page=25&filter=type:journal`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const j: any = await r.json();
    return (j.results ?? []).map((s: any): JournalHit => ({
      issn: (s.issn_l as string) || (Array.isArray(s.issn) ? s.issn[0] : "") || "",
      title: String(s.display_name ?? ""),
      publisher: s.host_organization_name ?? null,
      homepage: s.homepage_url ?? null,
      scopus: !!s.is_indexed_in_scopus,
      doaj: !!s.is_in_doaj,
      pubmed: false,
      openaccess: !!s.is_oa,
      apc: s.apc_usd ?? null,
      impact: typeof s.summary_stats?.["2yr_mean_citedness"] === "number" ? +s.summary_stats["2yr_mean_citedness"].toFixed(2) : null,
      scope: null,
      sources: ["openalex"],
    })).filter((h: JournalHit) => h.issn && h.title);
  } catch { return []; }
}

// ---------- DOAJ ----------
async function doajLookup(issn: string): Promise<{ apc?: number | null; oa?: boolean } | null> {
  try {
    const r = await fetch(`https://doaj.org/api/search/journals/issn:${encodeURIComponent(issn)}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j: any = await r.json();
    const first = j.results?.[0];
    if (!first) return null;
    const bib = first.bibjson ?? {};
    const apc = bib.apc?.max?.[0]?.price ?? null;
    return { apc: typeof apc === "number" ? apc : null, oa: true };
  } catch { return null; }
}

// ---------- Crossref ----------
async function crossrefRecent(issn: string): Promise<Array<{ title: string; year?: number; doi?: string }>> {
  try {
    const r = await fetch(`https://api.crossref.org/journals/${encodeURIComponent(issn)}/works?rows=5&select=title,DOI,issued`, {
      headers: { Accept: "application/json", "User-Agent": "ScholarlyWriteAI/1.0" },
    });
    if (!r.ok) return [];
    const j: any = await r.json();
    return (j.message?.items ?? []).map((w: any) => ({
      title: String(w.title?.[0] ?? ""),
      year: w.issued?.["date-parts"]?.[0]?.[0],
      doi: w.DOI,
    }));
  } catch { return []; }
}

// ---------- Scopus (optional) ----------
async function scopusSearch(query: string, apiKey: string): Promise<JournalHit[]> {
  try {
    const r = await fetch(`https://api.elsevier.com/content/serial/title?query=${encodeURIComponent(query)}&count=25`, {
      headers: { "X-ELS-APIKey": apiKey, Accept: "application/json" },
    });
    if (!r.ok) return [];
    const j: any = await r.json();
    const items = j["serial-metadata-response"]?.entry ?? [];
    return items.map((e: any): JournalHit => ({
      issn: (e["prism:issn"] as string) || (e["prism:eIssn"] as string) || "",
      title: String(e["dc:title"] ?? ""),
      publisher: e["dc:publisher"] ?? null,
      homepage: null,
      scopus: true,
      doaj: false,
      pubmed: false,
      openaccess: e["openaccess"] === "1" || e["openaccessFlag"] === true,
      apc: null,
      impact: typeof e["citeScoreYearInfoList"]?.citeScoreCurrentMetric === "string"
        ? Number(e["citeScoreYearInfoList"].citeScoreCurrentMetric) || null : null,
      scope: null,
      sources: ["scopus"],
    })).filter((h: JournalHit) => h.issn && h.title);
  } catch { return []; }
}

// ---------- caching ----------
async function withCache(supabase: any, key: string, source: string, ttlDays: number, load: () => Promise<any>) {
  const { data: cached } = await supabase.from("journal_cache").select("payload,fetched_at").eq("issn", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ttlDays * 86400_000) return cached.payload;
  const fresh = await load();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("journal_cache").upsert({ issn: key, source, payload: fresh, fetched_at: new Date().toISOString() });
  return fresh;
}

// ---------- server fns ----------
const searchSchema = z.object({
  project_id: z.string().uuid(),
  query: z.string().min(1).max(500).optional(),
  use_scopus: z.boolean().optional().default(false),
});

export const searchJournals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => searchSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects").select("title,abstract,discipline,mode").eq("id", data.project_id).single();
    if (!project) throw new Error("Project not found");
    const query = (data.query || `${project.title} ${project.discipline ?? ""}`.trim()).slice(0, 300);

    const scopusKey = process.env.SCOPUS_API_KEY;
    const jobs: Array<Promise<JournalHit[]>> = [openAlexSearch(query)];
    if (data.use_scopus && scopusKey) jobs.push(scopusSearch(query, scopusKey));
    const settled = await Promise.all(jobs);
    const byIssn = new Map<string, JournalHit>();
    for (const list of settled) {
      for (const h of list) {
        const existing = byIssn.get(h.issn);
        if (!existing) byIssn.set(h.issn, h);
        else {
          existing.scopus = existing.scopus || h.scopus;
          existing.doaj = existing.doaj || h.doaj;
          existing.openaccess = existing.openaccess || h.openaccess;
          existing.impact = existing.impact ?? h.impact;
          existing.apc = existing.apc ?? h.apc;
          existing.sources = Array.from(new Set([...existing.sources, ...h.sources]));
        }
      }
    }
    let hits = [...byIssn.values()];

    // DOAJ enrichment for top 15 (concurrent)
    const enrichSlice = hits.slice(0, 15);
    const doajResults = await Promise.all(enrichSlice.map((h) => doajLookup(h.issn)));
    doajResults.forEach((r, i) => {
      if (!r) return;
      enrichSlice[i].doaj = true;
      if (enrichSlice[i].apc == null) enrichSlice[i].apc = r.apc ?? null;
      if (r.oa) enrichSlice[i].openaccess = true;
    });

    // AI relevance rerank on top 25 (single call)
    const model = pickModel(project.mode);
    const top = hits.slice(0, 25).map((h, i) => ({ i, title: h.title, publisher: h.publisher, impact: h.impact }));
    let ranking: Array<{ i: number; score: number; why: string }> = [];
    if (top.length) {
      const raw = await chatJSON<any>({
        model,
        system: "You rate how well each journal matches a research abstract. Return strict JSON {ranked:[{i,score,why}]} with score 0-100.",
        prompt: `Project title: ${project.title}\nDiscipline: ${project.discipline ?? ""}\nAbstract: ${(project.abstract ?? "").slice(0, 1500)}\n\nCandidates:\n${top.map((t) => `#${t.i}: ${t.title} (${t.publisher ?? "?"}, impact ${t.impact ?? "n/a"})`).join("\n")}`,
        temperature: 0.1, maxOutputTokens: 1400,
      });
      ranking = Array.isArray(raw?.ranked) ? raw.ranked.slice(0, 25) : [];
    }
    for (const r of ranking) {
      const h = hits[r.i]; if (!h) continue;
      h.fit_score = Math.round(Number(r.score) || 0);
      h.fit_why = String(r.why ?? "").slice(0, 240);
    }
    hits = hits.sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0));

    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "journals:search", model });
    return { query, results: hits.slice(0, 25), scopus_enabled: !!scopusKey };
  });

export const getJournalProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ issn: z.string().min(4).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const key = data.issn;
    const profile = await withCache(context.supabase, `profile:${key}`, "openalex+crossref", 30, async () => {
      const [openAlex, recent, doaj] = await Promise.all([
        openAlexSearch(key),
        crossrefRecent(key),
        doajLookup(key),
      ]);
      const base = openAlex.find((h) => h.issn === key) ?? openAlex[0];
      if (!base) throw new Error("Journal not found");
      if (doaj) { base.doaj = true; if (base.apc == null) base.apc = doaj.apc ?? null; if (doaj.oa) base.openaccess = true; }
      return { ...base, recent_articles: recent, submission_url: base.homepage } as JournalProfile;
    });
    return profile as JournalProfile;
  });

const fitSchema = z.object({ project_id: z.string().uuid(), issn: z.string().min(4).max(20) });
export const fitCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fitSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("title,abstract,discipline,mode").eq("id", data.project_id).single();
    if (!project) throw new Error("Project not found");
    const profile = await getJournalProfile({ data: { issn: data.issn } } as any);
    const recentTitles = (profile.recent_articles ?? []).map((a) => `- ${a.title}`).join("\n");
    const model = pickModel(project.mode);
    const raw = await chatJSON<any>({
      model,
      system: "You assess journal fit for a manuscript. Return strict JSON {score, reasons[], risks[], suggestedEdits[]}. Score 0-100.",
      prompt: `Journal: ${profile.title} (${profile.publisher ?? ""})\nIndexing: Scopus=${profile.scopus} DOAJ=${profile.doaj} OA=${profile.openaccess}\nRecent article titles:\n${recentTitles}\n\nManuscript title: ${project.title}\nDiscipline: ${project.discipline ?? ""}\nAbstract: ${(project.abstract ?? "").slice(0, 1800)}`,
      temperature: 0.2, maxOutputTokens: 900,
    });
    await supabase.from("ai_usage").insert({ project_id: data.project_id, user_id: userId, kind: "journals:fit", model });
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(raw?.score) || 0))),
      reasons: (Array.isArray(raw?.reasons) ? raw.reasons : []).slice(0, 6).map((s: any) => String(s).slice(0, 240)),
      risks: (Array.isArray(raw?.risks) ? raw.risks : []).slice(0, 6).map((s: any) => String(s).slice(0, 240)),
      suggestedEdits: (Array.isArray(raw?.suggestedEdits) ? raw.suggestedEdits : []).slice(0, 6).map((s: any) => String(s).slice(0, 300)),
      profile,
    };
  });

// ---------- shortlist CRUD ----------
export const listShortlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("journal_shortlist").select("*").eq("project_id", data.project_id).order("order").order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addToShortlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    project_id: z.string().uuid(), issn: z.string(), title: z.string(),
    publisher: z.string().nullable().optional(), homepage: z.string().nullable().optional(),
    fit: z.any().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const row = { ...data, user_id: context.userId, publisher: data.publisher ?? null, homepage: data.homepage ?? null };
    const { data: inserted, error } = await (context.supabase as any)
      .from("journal_shortlist").upsert(row, { onConflict: "project_id,issn" }).select().single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const removeFromShortlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("journal_shortlist").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateShortlistStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), status: z.enum(["considering", "target", "submitted", "rejected", "accepted"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).from("journal_shortlist").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
