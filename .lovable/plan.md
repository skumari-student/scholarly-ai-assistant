## Phase 1.2 — Analysis & Visuals

Rename the existing **Visuals** tab to **Analysis & Visuals** and extend it with a data-upload path, richer chart preview, and export attachment. Reuse the existing `generateVisual` + `runVoiceCommand` pipelines to keep credits low.

### 1. Server: data parsing + analysis

- New `src/lib/analysis.server.ts`:
  - `parseCsv(text)` — tiny CSV parser (quoted fields, commas/tabs, first row = headers).
  - `parseXlsx(bytes)` — use existing `xlsx` capability via lazy `await import("xlsx")` inside handler; add to deps.
  - Returns `{ columns: string[]; rows: (string|number)[][]; rowCount; sample }` with rows capped at 200 and 20 columns to bound prompts.
- New `src/lib/ai/analysis.functions.ts`:
  - `analyzeDataset({ project_id, upload_id? , inline_csv? , prompt? })` — loads file from `uploads` bucket (or inline paste), parses it, sends a **summary + sample** (max ~40 rows) to AI with a strict JSON schema:
    ```
    { summary, keyFindings[], recommendedCharts:[{title,type:'bar'|'line'|'pie'|'scatter',x,y,rationale,data:[{label,value,series?}]}], table:{title,columns,rows}, citations[] }
    ```
    Uses `pickModel(project.mode)` and `chatJSON`, plus `project.refs` list so the AI can suggest existing citations.
  - `analyzeSectionText({ project_id, section_id, prompt? })` — same output shape, source = section outline+draft; encourages "as reported by [Author, Year]" wording using project refs.

### 2. Chart rendering

- Extend `VisualPreview` (already uses Recharts `BarChart`) with `LineChart`, `PieChart`, `ScatterChart`. Chart type comes from the AI response.
- New `<DatasetChart chart={rec}>` renders a single suggested chart card with title, rationale, data-fields chip, and preview.

### 3. UI: Analysis & Visuals panel

Rewrite `VisualsPanel` (kept in same file) as a tabbed sub-panel:

- **Sub-tab "Text"** — current behaviour (kind selector + prompt + generate single visual). Keep as-is.
- **Sub-tab "Data"** — new:
  - Source picker: **This section's text** | **Upload data file** | **Paste CSV**.
  - Upload uses existing `createUploadUrl`/`listUploads` (project-uploads bucket, accepts `.csv,.xlsx,.xls`). Show list of uploaded data files with "Analyze" button.
  - Paste CSV textarea (fast path, no upload).
  - "Summarize data & propose visuals" button → calls `analyzeDataset`.
  - Result card: summary text, key findings bullets, rendered HTML table, and a grid of chart previews (one card per recommended chart). Each card has:
    - **Insert description** — inserts a text block (title + caption + which refs cited) into the current section.
    - **Insert table (markdown)** — inserts markdown table into section.
    - **Attach to export** — persists a `visual` row (see #5) so it appears in the export.
- Dictation mic at top of Data sub-tab: reuse `VoiceCapture` → `extractFromNarration` (already in project) to fill the prompt/`variables` field; long narration becomes analysis request.

### 4. Persistence: attached visuals

- Small new table `project_visuals` (project_id, section_id nullable, kind, title, caption, payload jsonb, order, timestamps) with RLS `auth.uid() = user_id` via project ownership. Migration will include GRANT + policies.
- Server fns: `listVisuals(project_id)`, `attachVisual(payload)`, `deleteVisual(id)`.
- Not persisting chart images — payload holds the JSON so export can re-emit the markdown/table.

### 5. Export integration (light)

- `src/lib/export.functions.ts` — when a project has attached visuals, append **"## Visuals & Analysis"** to Markdown, HTML, and DOCX outputs. For each visual: title, caption, markdown table (rendered as real table in DOCX/HTML), and a short "Suggested chart: <type> of <x> vs <y>" line. No chart drawing.

### 6. Housekeeping

- Rename tab label to **"Analysis"** in the TabsList (keeps `value="visuals"` for stability).
- Add `xlsx` to package.json.
- Reuse existing `uploads` table (kind already covers files); no schema change there.

### Technical notes

```text
Client → analyzeDataset (serverFn, auth) → parse in worker (bounded)
                                        → chatJSON({project.mode})
                                        → save ai_usage row
                                        → return {summary,findings,charts[],table,citations}
Client renders → Recharts by chart.type; user picks Insert / Attach
attachVisual → project_visuals row (RLS by owner)
exportProject → append Visuals & Analysis section from project_visuals
```

Credit safety: cap rows to 40 in prompt, columns to 20, prompt total ≤ 6k chars; use Flash by default (project.mode = "low_credit"); one AI call per action.

### How to test after build

1. Open any project → right panel → **Analysis** tab.
2. **Text path**: pick "Table", click Generate — same as before.
3. **Data path**: sub-tab **Data** → paste this CSV and click *Summarize*:
   ```
   Group,Pre,Post
   Control,12,14
   Treatment,11,19
   ```
   Expect: summary text, findings bullets, one HTML table, 1–3 chart previews (bar/line/pie).
4. Upload a small `.csv` or `.xlsx` (≤200 rows) → click **Analyze** on the file row → same result.
5. Click **Attach to export** on a chart card → open **Export** → download DOCX/Markdown → verify a "Visuals & Analysis" section appears with the table and chart description.
6. Dictate: click mic in Data sub-tab, say *"Compare pre and post scores between control and treatment groups, suggest a bar chart"* — prompt fills in, run generates matching visuals.