
# ScholarlyWrite AI — Diagnostic Report (Plan mode, no code changes)

Scope: inspection only. Findings are based on reading the routes, server functions, integrations, and current-turn context. Concrete fixes are proposed for later Build mode.

## A. High-level file map

- Auth & sessions: `src/routes/__root.tsx`, `src/routes/auth.tsx`, `src/routes/_authenticated/route.tsx`, `src/integrations/supabase/client.ts`, `src/integrations/supabase/auth-middleware.ts`, `src/integrations/supabase/auth-attacher.ts`, `src/start.ts`, `src/integrations/lovable/index.ts`.
- Editor / workspace: `src/routes/_authenticated/projects.$id.index.tsx`, `src/lib/projects.functions.ts`, `src/lib/ai/writing.functions.ts`, `src/lib/text.ts`.
- References / citations: `src/lib/refs.functions.ts`, `src/lib/citations.ts`, `src/lib/doc-templates.ts`, editor `Refs` tab.
- Save behaviour: `scheduleSave`/`flushSave`/`saveNow`/`SaveIndicator` in `projects.$id.index.tsx`.
- Voice / dictation / command: `src/components/voice-capture.tsx`, `src/routes/api/stt.ts`, `src/lib/ai/voice.functions.ts`.
- Brainstorm / Topics / Journals suggestions: `src/lib/ai/topics.functions.ts`, `src/lib/ai/journals.functions.ts` (AI variant), editor right-panel tabs.
- Export: `src/routes/_authenticated/projects.$id.export.tsx`, `src/lib/export.functions.ts`, `src/lib/doc-templates.ts`.
- Library / gallery: `src/lib/uploads.functions.ts`, `Library` tab in editor.
- Data Lab: `src/routes/_authenticated/projects.$id.lab.tsx`, `src/lib/datasets.functions.ts`, `src/lib/analysis.server.ts`, `src/lib/stats.server.ts`, `src/lib/ai/quant.functions.ts`, `src/lib/ai/qual.functions.ts`, `src/lib/visuals.functions.ts`.
- Journals intelligence: `src/routes/_authenticated/projects.$id.journals.tsx`, `src/lib/journals.functions.ts` (OpenAlex/DOAJ/Scopus).
- Submission assistant: `src/routes/_authenticated/projects.$id.submit.tsx`, `src/lib/submission.functions.ts`, `src/lib/export.functions.ts`.

## B. Per-module diagnostic

Method: cross-check server-fn signatures, table columns (from `<supabase-tables>` and schema notes in context), UI wiring in `projects.$id.index.tsx`, and known Phase 1.2/2 changes. Diagnoses marked "unconfirmed" require a targeted read/query in Build mode before fixing.

### 1. Auth & sessions — Status: OK (minor)
- Root `onAuthStateChange` listener present; gate uses `getSession()` for fast local validation; Google OAuth via `lovable.auth.signInWithOAuth`.
- Watch item (unconfirmed): ensure the root listener filters events (`SIGNED_IN`/`SIGNED_OUT`/`USER_UPDATED`) and does NOT invalidate queries on `SIGNED_OUT` (401 storm risk). Confirm sign-out flow: cancel queries → clear cache → `signOut()` → `navigate({to:"/auth", replace:true})`.
- Build-mode fix (if needed): tighten `__root.tsx` listener filter; add proper sign-out hygiene in header menu.

### 2. Editor & AI actions — Status: OK
- `WRITING_ACTIONS` wired to `runWritingAction` with `intensive` flag gated by `LIT_REVIEW_KEYS`; insert modes replace/append/outline implemented; section switching flushes save.
- Risk (unconfirmed): AI JSON responses wrapped in Markdown fences or Gemini "reasoning" blocks may occasionally break `chatJSON` parsing (noted last turn).
- Build-mode fix: harden `chatJSON` (strip ```json fences and reasoning prefixes); add per-action toast when `output` empty.

### 3. Word count & status — Status: OK
- `countWords` from `src/lib/text.ts` used for section + project totals; `updateProjectStatus` + Switch wired; status pill renders.
- No issues expected.

### 4. References & citations (styles + intensive) — Status: Partial (unconfirmed)
- Refs CRUD via `refs.functions.ts`; style selector calls `updateProjectCitationStyle`; `formatReferenceList`/`inTextCitation` present.
- Concern 1: style change updates DB, but the live editor draft text is not re-rendered with the new style (in-text citations are baked into prose by `runWritingAction`, not re-computed). Users may expect "switch style → all citations reflow", which won't happen until they re-run "Add citations".
- Concern 2: `citeAllSections` intensive path relies on refs having enough metadata (authors/year); BibTeX imports may leave gaps → weak citations.
- Build-mode fixes: (a) show a toast on style change: "Re-run Add citations to apply"; (b) validate ref completeness before AI cite; (c) verify `citations.ts` handles missing year gracefully.

### 5. Save behaviour — Status: OK
- Debounced `scheduleSave` (800ms), `flushSave`, `saveNow`, and `SaveIndicator` states (`idle|dirty|saving|saved`) all present. Section switch triggers `flushSave`.
- Minor: `pendingRef` merge on `scheduleSave` line 213 has a redundant self-spread; harmless.

### 6. Voice: Dictation + Command — Status: Partial
- Dictation path (VoiceCapture → `/api/stt` → SSE parse) is implemented and hardened this session (delta buffer fixed). Should work.
- Command mode (unconfirmed): editor has mic buttons that call `onTranscript` and push text into content/outline — this is DICTATION only. There is no visible dedicated "Command" toggle wiring `runVoiceCommand`/`extractFromNarration` to an "Apply" panel in most tabs (voice-command panel exists in the "Voice" tab per earlier work, but Topics/Journals/Brainstorm mic buttons feed dictation into a text field rather than issuing structured commands).
- Root causes: `VoiceCapture` has a single `onTranscript` prop with no `mode` distinction; command handlers not passed to Topics/Journals/Brainstorm panels.
- Build-mode fixes: add a `mode?: "dictate" | "command"` prop to `VoiceCapture`, or a sibling `<VoiceCommand>` component; wire `runVoiceCommand`/`extractFromNarration` results into an Apply preview for each panel; verify `/api/stt` returns SSE across viewport sizes.

### 7. Brainstorm & topic extraction — Status: Partial (unconfirmed)
- `brainstormIdeas`, `extractTopicFromText`, `insertTopics` exist. UI has Brainstorm tab.
- Likely issue: prior turn noted "Brainstorming and topic extraction return no results". Root cause candidates: (a) `chatJSON` returning empty array when model wraps output; (b) `context_notes` field empty for new projects so prompt lacks grounding; (c) rendering only when result shape matches expected keys.
- Build-mode fixes: robust JSON parse fallbacks; empty-state UI; log server-fn errors to toast; check response shape in the component.

### 8. Topic & journal suggestions — Status: OK (with gaps)
- `generateTopics`, `generateJournals` with pin/delete wired; AI-generated only (Phase 1 behaviour).
- Gap: with Phase 2 shipping OpenAlex/DOAJ intelligence on `/journals`, the in-editor Journals tab still shows AI-only list — dual sources may confuse users.
- Build-mode fix: add "See advanced search →" link from Journals tab to `/projects/$id/journals`.

### 9. Export — Status: OK (Phase 1) / Partial (Phase 1.2)
- DOCX and Markdown verified working last turn (post routing fix). PDF is a print-based flow.
- Concern: "Visuals summary" append (added Phase 1.2) — need to confirm `project_visuals` rows are loaded and that DOCX generation doesn't crash when visuals are absent or partial. Also confirm submission-package DOCX (`exportSubmissionPackage`) generates without errors when checklist/cover letter missing.
- Build-mode fixes: add defensive null checks in `export.functions.ts`; unit-test export against empty project.

### 10. Library / gallery — Status: OK (unconfirmed)
- `listUploads`, `createUploadUrl`, `recordUpload`, `attachUpload`, `deleteUpload` wired; Library tab present.
- Verify signed URL expiry and image thumbnails render for MIME variants (jpg/png/pdf).
- Build-mode fix (if broken): standardise URL creation and MIME handling.

### 11. Phase 2 — Data Lab / Journals / Submission

**Data Lab — Status: Partial (needs verification)**
- Backend complete: `datasets.functions.ts`, `quant.functions.ts`, `qual.functions.ts`, `analysis.server.ts`, `stats.server.ts`; route `projects.$id.lab.tsx` scaffolded last turn.
- Risks: (a) `datasets` table typed as `any` in server fns (`(supabase as any).from("datasets")`) — types may not include the new table, so runtime shape drift; (b) CSV/XLSX 200-row cap not communicated in UI; (c) attach-to-export flow uses `visuals.functions.ts` — confirm quant/qual results save as visuals.
- Build-mode fixes: regenerate Supabase types; add empty/error states; add "attach result" button on quant/qual result cards; surface parsing warnings.

**Journals intelligence — Status: Partial**
- OpenAlex/DOAJ/Scopus providers implemented; route present.
- Risks: (a) Scopus requires user-supplied API key — key input UI + secret storage need to be verified; (b) network egress from Worker to external APIs works but rate limits/errors need surfacing; (c) `journal_cache` freshness policy not documented; (d) shortlist add/remove buttons need to be wired to `journal_shortlist`.
- Build-mode fixes: cache TTL; explicit error toasts per provider; Scopus opt-in banner + Settings secret input; verify shortlist CRUD.

**Submission assistant — Status: Partial**
- `generateCoverLetter`, `buildChecklist`, `exportSubmissionPackage` implemented; route scaffolded.
- Risks: (a) checklist depends on target journal metadata (word limits, required sections) which may be missing when using AI-only suggestions; (b) citation verify step reads refs but needs a clear "N unresolved" summary; (c) combined DOCX package requires all sections + cover letter — must handle partial data.
- Build-mode fixes: default checklist rules when journal metadata is missing; unresolved-citation summary UI; guard `exportSubmissionPackage` against missing sections/refs.

## C. Summary

**Fully working (or expected OK):** Auth, Editor & AI actions, Word count/status, Save behaviour, Export (DOCX/MD), AI topic/journal suggestions, Library.

**Partially working:** References/Citations (style-change UX), Voice (command mode not wired across panels), Brainstorm/topic extraction (results empty per prior report), Data Lab UI, Journals intelligence UI, Submission assistant UI, PDF export (print-based).

**Not working / not wired:** None hard-broken as far as reads confirm — but several Phase 2 UI surfaces (`lab`, `journals`, `submit`) are recently scaffolded and unverified end-to-end.

## Recommended Build-mode order (when you approve)

1. Voice command wiring across Topics/Journals/Brainstorm + `chatJSON` JSON hardening (unblocks Brainstorm empty-results too).
2. Phase 2 UI verification pass: `lab`, `journals`, `submit` — run each flow, fix null/empty states, regenerate Supabase types.
3. Citation style-change UX + intensive citation ref-completeness check.
4. Export defensive checks (Visuals summary, submission package) + PDF flow polish.
5. Auth sign-out hygiene and root listener filtering (only if a real symptom surfaces).

Tell me which of these to tackle first and I'll switch to Build mode.
