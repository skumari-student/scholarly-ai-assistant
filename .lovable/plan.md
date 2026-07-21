
## Phase 2 — Data Lab, Journal Intelligence, Submission Assistant

Builds on the stable Phase 1.2 workspace. Reuses the existing `analyzeDataset`, `project_visuals`, `refs`, `uploads`, `pickModel`, `chatJSON`, and `VoiceCapture` primitives. No changes to auth or editor shell.

---

### 1. Data Lab (quant + qual)

A dedicated `/projects/$id/lab` route (sibling of `/export`), plus a **Data Lab** tab in the workspace right panel that deep-links into it.

**Datasets**
- New table `datasets` (project_id, upload_id nullable, name, source: `upload|paste|section`, columns jsonb, row_count, sample jsonb, kind: `quant|qual|mixed`, created_at).
- Reuse `project-uploads` bucket + `uploads` table. On upload of `.csv/.xlsx/.txt/.docx`, prompt user to "Add to Data Lab" — creates a `datasets` row via server fn (`registerDataset`) that runs the existing `parseCsv`/`parseXlsx` (extend `analysis.server.ts` with `parseTextCorpus` for qual).
- List, rename, delete datasets. Preview first 20 rows.

**Quantitative analyses** (server fn `runQuantAnalysis` — one AI call + deterministic compute in the worker):
- Descriptive stats (mean, median, sd, min/max, quartiles, missing count) — computed in JS (no AI).
- Correlation matrix (Pearson) — computed in JS; AI writes interpretation paragraph.
- Group comparison (t-test / Mann-Whitney approximation) — compute stats in JS; AI narrates.
- Simple linear regression (single predictor) — closed-form OLS in JS; AI narrates.
- Frequency tables + crosstabs — JS.
- Each result stored as a `project_visuals` row (kind `analysis:quant`) with payload `{ method, inputs, stats, chart, narrative, citations[] }` so it flows into existing export pipeline.

**Qualitative analyses** (server fn `runQualAnalysis`):
- Input: pasted transcript, `.txt`/`.docx` upload, or a section's draft.
- AI passes (single call each, Flash by default):
  - **Code + theme extraction** → returns `{ codes:[{name,definition,evidence:[{quote,source}]}], themes:[{name,rationale,codes[]}] }`.
  - **Sentiment / stance summary** for interview-like data.
  - **Comparative matrix** across multiple documents (participant × theme grid, rendered as table).
- Store as `project_visuals` (kind `analysis:qual`).

**Mixed-methods** view: pick one quant + one qual result and generate a joint discussion paragraph (`synthesizeMixed`, AI, cites `refs`).

**Reusable UI**: extend `DatasetChart` with box/whisker (approx via Recharts Bar+ErrorBar) and heatmap (Recharts custom cells) for correlation matrices.

---

### 2. Journal Intelligence (Scopus + reputed platforms)

Upgrade Phase 1's AI-only journal suggestions into a data-backed recommender.

**Data providers** (all opt-in, gracefully degrade):
- **OpenAlex** (no key) — primary free source for journal metadata, works, and 2yr mean citedness (proxy for impact).
- **Crossref** (no key) — journal existence, ISSN, publisher, recent articles for scope match.
- **DOAJ** (no key) — open-access indexing + APC info.
- **Scopus** via Elsevier API — behind an optional `SCOPUS_API_KEY` secret. Ask user via `add_secret` only when they enable "Use Scopus". No hardcoded key.

Add secrets flow: on first click of "Enable Scopus", explain what's needed and where to get it, then request `SCOPUS_API_KEY` through `add_secret`. Everything else works without any secret.

**Server functions** (all `requireSupabaseAuth`):
- `searchJournals({ project_id, query?, useScopus? })` — builds a query from project title + abstract + top keywords, calls providers in parallel, deduplicates by ISSN, and ranks by a scoring blend (topic-match via embeddings-free lexical + AI relevance rerank on the top 25, plus impact proxy and open-access preference).
- `getJournalProfile({ issn })` — cached profile: aims/scope (AI summary of homepage + recent titles), acceptance signals, APC, average time-to-decision if published, indexing (Scopus/DOAJ/PubMed flags), publisher, ISSN, homepage/submission URLs.
- `fitCheck({ project_id, issn })` — AI reads project abstract + section titles vs. journal profile and returns `{ score, reasons[], risks[], suggestedEdits[] }`.

**Storage**
- New table `journal_cache` (issn PK, source, payload jsonb, fetched_at) — 30-day TTL, keyed lookups; keeps API calls low.
- New table `journal_shortlist` (project_id, issn, notes, status: `considering|target|submitted|rejected|accepted`, order).

**UI** — rewrite existing Journals tab:
- Search bar + filters (open access, region, indexing, min impact).
- Result cards: title, publisher, indexing badges (Scopus/DOAJ/PubMed), impact proxy, APC, fit score with "Why".
- "Add to shortlist" → appears in a shortlist column with drag-reorder.
- "Fit check" runs `fitCheck` and shows a checklist with suggested edits (button to auto-apply as a section suggestion via existing `journal_suggestions`).

---

### 3. Submission Assistant

A `submission` object per project (one row). Guides the user from "target picked" to "submission-ready package".

**Table**: `submissions` (project_id PK, target_issn nullable, cover_letter text, checklist jsonb, package jsonb, status: `draft|ready|submitted`, submitted_at).

**Features**
- **Cover letter generator**: `generateCoverLetter({ project_id, issn })` — uses project meta, key findings from `project_visuals`, and journal profile. Editable Markdown, saved to `submissions.cover_letter`.
- **Compliance checklist**: derived from journal profile — word count vs limits, abstract length, reference style (compare against project.citation_style), section requirements (IMRaD? structured abstract? competing interests? data availability?), figure/table counts. Each item computed deterministically where possible; AI fills gaps ("does the manuscript include an ethics statement?").
- **Reference style verifier**: `verifyCitations({ project_id, issn })` — checks each `refs` row for completeness for the target style and lists items needing attention.
- **Author disclosures**: simple form — funding, conflicts of interest, contributions (CRediT taxonomy dropdowns), data availability statement — stored in `submissions.package`.
- **Submission package export**: extends `export.functions.ts` to emit a zip-equivalent set — manuscript DOCX, title page DOCX, cover letter DOCX/PDF, references list, and a `submission.json` summary. Since worker can't ship a real zip cheaply, offer sequential downloads plus a single "Combined DOCX" (title page + cover + manuscript).
- **Status tracking**: minimal — record submitted/decision dates against shortlist entries.

---

### 4. Cross-cutting

- **Credit safety**: reuse `pickModel(project.mode)`; keep Flash default; cap AI-touched rows/quotes (200 rows, 40-quote qual samples, top-25 journal rerank). One AI call per user action; deterministic work in JS.
- **Voice**: reuse `VoiceCapture` + `extractFromNarration` in Data Lab prompt boxes, journal search bar, and cover letter editor.
- **Citations-aware**: quant/qual narratives and cover letters pull from `refs` (existing `refsBlock` helper pattern from `analysis.functions.ts`).
- **RLS**: every new table follows the standard `auth.uid() = user_id via project` pattern with GRANTs to `authenticated` + `service_role`.
- **No new edge functions**; all logic in `createServerFn` under `src/lib/ai/*.functions.ts` and `src/lib/*.functions.ts`. External HTTP (OpenAlex, Crossref, DOAJ, Scopus) called from server functions with basic in-memory + `journal_cache` caching.

---

### Technical section

```text
Data Lab
  datasets (new)         ← registerDataset, listDatasets, deleteDataset
  project_visuals (existing) ← runQuantAnalysis, runQualAnalysis, synthesizeMixed
  analysis.server.ts     ← + descriptive(), correlation(), ttest(), ols(), freq(), parseTextCorpus()
  DatasetChart           ← + box, heatmap

Journals
  journal_cache (new)    ← OpenAlex/Crossref/DOAJ/Scopus fetchers, 30d TTL
  journal_shortlist (new)
  searchJournals, getJournalProfile, fitCheck  (all requireSupabaseAuth)
  Optional SCOPUS_API_KEY via add_secret

Submission
  submissions (new)
  generateCoverLetter, verifyCitations, buildChecklist, exportSubmissionPackage
  export.functions.ts    ← + title page, cover letter, submission.json
```

Migrations (single file per group): `datasets`, `journal_cache`+`journal_shortlist`, `submissions`. Each with GRANTs + RLS + `updated_at` trigger.

### How to test
1. **Data Lab quant**: upload the sample CSV → open Data Lab → run *Descriptive stats* and *Correlation* → cards render, Attach to export → export DOCX shows both.
2. **Data Lab qual**: paste a short interview → run *Codes & themes* → theme table renders → Attach → export DOCX shows quotes + themes.
3. **Journals (no Scopus)**: click *Find journals* → results appear from OpenAlex/Crossref/DOAJ with indexing badges → Add to shortlist → Fit check produces score and edit suggestions.
4. **Journals (Scopus)**: click *Enable Scopus* → prompted for key → after saving, re-run search → Scopus badge shows on relevant rows.
5. **Submission**: pick target journal → *Generate cover letter* → edit → checklist shows compliance items → *Download submission package* yields manuscript, cover letter, title page, references.
