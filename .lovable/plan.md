# Phase 1.1 Fix Pass — Plan

Most of these features were touched in earlier turns but you're still seeing them broken. Rather than re-patching blindly, step 1 is a targeted diagnostic pass against the current files so each fix is grounded in what's actually wrong right now.

## Step 1 — Diagnose (read-only)

Batch-read the current state of:
- `src/components/voice-capture.tsx` (SSE parsing, MIME/extension handling)
- `src/routes/api/stt.ts` (already confirmed: proxies to `openai/gpt-4o-mini-transcribe`, streams SSE)
- `src/lib/ai/voice.functions.ts`, `src/lib/ai/topics.functions.ts`
- `src/lib/ai/writing.functions.ts` (verify `intensive` + `cite` paths, ref context build)
- `src/lib/ai-gateway.server.ts` (model wiring, error surfacing)
- `src/lib/export.functions.ts` + `src/routes/_authenticated/projects.$id.export.tsx`
- `src/routes/_authenticated/projects.$id.tsx` (header style selector, save pill, Brainstorm tab, Library/Journals panels, mic wiring per tab)
- `src/lib/projects.functions.ts` (updateProjectCitationStyle / updateProjectStatus presence)

Then run a live check: dictate into the editor and inspect `/api/stt` network + console, and try one export of each format, capturing the actual error message. Only after that, apply fixes below (scoped to what the reads/repro actually show is broken — no speculative rewrites).

## Step 2 — Fixes by area

### 2.1 Dictation / voice capture
- If `VoiceCapture` is not mounted in Brainstorm / Topics / Journals / per-section, add it there with an `onTranscript` handler that writes to the correct field.
- If SSE deltas drop or `done.text` is empty, fix the parser to accumulate `transcript.text.delta` and fall back to concatenated deltas.
- Ensure the uploaded WAV's filename matches its MIME (`.wav`) so the provider doesn't 400.
- On non-2xx `/api/stt`, surface the server message via `toast.error`; on empty transcript show "No speech detected".
- Command mode: pipe transcript through `runVoiceCommand` (editor) or `extractFromNarration` (Brainstorm/Topics) and open the existing Apply panel.

### 2.2 Brainstorm + topic extraction
- Verify `brainstormIdeas` and `extractTopicFromText` exist, are wrapped in `createServerFn`, and return typed JSON (`ideas[]`, `problems[]`, `questions[]`, `implicitTopic`, `betterStatements[]`, `subtopics[]`).
- In the Brainstorm tab, wire buttons to `useServerFn(...)` + local `useState` (not `useQuery` unless keyed), render results, and show loading/error states.
- "Extract from current section" passes `sections[current].content`; voice extraction passes the transcript.

### 2.3 Citation style + save
- Header: shadcn `<Select>` bound to `project.citation_style`, `onValueChange` → `updateProjectCitationStyle` + invalidate project query so `ReferencesPanel` and formatters re-render.
- Save state machine in the editor: `idle | dirty | saving | saved`. `scheduleSave` sets `dirty` on change, `saving` when debounce fires, `saved` on success (revert to `idle` after 2s). "Save now" flushes debounce and calls the same mutation.
- Confirm `formatReferenceList` / in-text citation helpers read the live `project.citation_style`.

### 2.4 Per-section citations
- Confirm `runWritingAction` receives `{ intensive, refs }` and its prompt builds a compact ref context (author-year + title + id) and instructs the model to insert in-text citations in the current style.
- Add a `cite` action (or reuse existing) available on every section that annotates the current draft with citations drawn from the project library.
- `citeAllSections` iterates sections and applies `cite`; wire a button in the header for one-shot pass.

### 2.5 Export
- Diagnose actual failure from the network response / thrown error (likely candidates: DOCX `Packer.toBase64String` in Worker runtime, `Buffer` usage, `docx` dynamic import, or missing `scope`/`section_id` in payload).
- Ensure `exportProject` returns `{ filename, mime, contentB64 }` for all three formats and that the client decodes base64 → Blob → download.
- PDF via server-generated HTML rendered in a hidden iframe → `print()` (already scaffolded — verify iframe cleanup and CSS `@page`).
- Export page: format selector (DOCX/PDF/MD), scope selector (Full / Current section) with section dropdown, Draft/Final toggle, progress toast + inline error on failure.

## Step 3 — Verify

- Playwright: sign in, open a project, dictate into a section, run brainstorm, switch citation style, toggle Intensive on Lit Review + Generate, export each format at each scope. Screenshot each result.
- Confirm no TS errors and no runtime errors in console.

## Out of scope
Auth, Data Lab, journal DB, submission assistant — untouched.

## Deliverable
On completion I'll list every file changed so you can smoke-test each area.
