## Plan: ScholarlyWrite AI workspace repair + AI visuals

### 1) Stabilize AI calls that power brainstorming, topic extraction, journals, and writing
- Replace the current raw AI Gateway helper with the supported Lovable AI SDK provider pattern.
- Keep model routing credit-efficient: low-credit mode uses `google/gemini-3.5-flash`; advanced mode uses `google/gemini-3.1-pro-preview`.
- Add robust JSON extraction/fallback handling so Brainstorming, Topics, Journals, and Topic Extraction return usable results instead of silently failing on slightly malformed AI JSON.
- Surface clear user-facing errors for AI credit/rate/validation failures.

### 2) Fix dictation/transcription
- Update `/api/stt` to use the Lovable AI speech-to-text request shape correctly with `LOVABLE_API_KEY`, a real WAV filename, streaming SSE, upload validation, and clear error responses.
- Improve the dictation component so it does not lose the final streaming event, handles Safari/browser audio startup more reliably, reports “no speech captured” vs “transcription failed”, and appends recognized text consistently.
- Keep the client-side WAV encoding approach because it is credit-efficient and avoids fragmented browser recording formats.

### 3) Make Brainstorming and Topic Extraction actually usable
- Keep the existing Brainstorming and Topics tabs, but make their actions show loading/results/errors consistently.
- Add voice dictation into these flows after the STT fix, so “From narration” can extract a topic reliably.
- Ensure saved brainstorm items and extracted topic statements insert into the existing `topics` table and refresh immediately.

### 4) Restore citation-style switching and save behavior
- Verify the existing citation-style selector and Save indicator call the backend successfully; fix any type/runtime issues that prevent them from appearing or persisting.
- Make “Save now” flush the current section reliably before AI generation, export, section changes, and page navigation.
- Add visible citation-style impact in references and generated citation previews so switching APA/MLA/Chicago/IEEE is obvious.

### 5) Add actual citations/references across every section
- Add a new AI action such as “Add citations” / “Cite section” that uses the project reference library and selected citation style to revise the active section with real in-text citations only from saved references.
- Add a project-wide “Cite all sections” action that processes sections one at a time to control credit usage.
- Append/update the references list in export output using the selected citation style.
- Make the AI explicitly avoid fabricated sources; if the library has no references, show a clear prompt to add/import references first.

### 6) Add AI-generated visuals with options and preview
- Add a new “Visuals” tab in the workspace with options for:
  - Table
  - Graph/chart
  - Concept map / framework
  - Timeline / workflow
  - Figure caption / visual summary
- Generate visuals as structured data from the current section, selected text, or a custom prompt.
- Show a preview in the workspace before insertion.
- For charts/graphs, render lightweight previews with the existing `recharts` dependency.
- Let the user insert the preview into the paper as Markdown/academic figure text so export can include it without adding new database schema.

### 7) Fix export
- Repair Markdown and DOCX export path so downloads work from the authenticated export page.
- Include all selected sections, AI-inserted visual blocks, and a references section formatted in the current citation style.
- Add better error handling in the export page so failures are visible rather than appearing to do nothing.

### Technical scope
- Files expected to change: `src/lib/ai-gateway.server.ts`, `src/routes/api/stt.ts`, `src/components/voice-capture.tsx`, `src/lib/ai/topics.functions.ts`, `src/lib/ai/writing.functions.ts`, `src/lib/projects.functions.ts` if save/style needs adjustment, `src/lib/export.functions.ts`, `src/routes/_authenticated/projects.$id.tsx`, and possibly `src/routes/_authenticated/projects.$id.export.tsx`.
- No auth changes.
- No project-table schema changes unless investigation shows a required column from the existing UI is missing at runtime.
- No unrelated Phase 2 features.

### Validation
- Run a focused build/type check.
- Test the main flows in the preview: dictation response handling, brainstorming/topic extraction, citation-style save, AI visual preview/insert, and export download behavior.
- If an AI Gateway request still fails, inspect the exact gateway log/error and fix the request shape instead of retrying blindly.