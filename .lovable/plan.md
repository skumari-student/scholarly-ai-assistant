# Phase 1.1 — Writing workspace upgrades

Scoped to the editor. No touching exports, Data Lab, submission assistant, auth, or unrelated AI functions. Reuses existing tables and the existing `runVoiceCommand` / `runWritingAction` server fns wherever possible.

## 1. Word count + project status

- **DB**: one small additive migration — `alter table public.projects add column status text not null default 'draft' check (status in ('draft','completed'));`. No RLS/grant changes (existing policies already cover the row).
- **Server fn** (`src/lib/projects.functions.ts`): add `updateProjectStatus({ id, status })`. `getProject` already returns `project.*` so status flows through.
- **Header (`projects.$id.tsx`)**:
  - Section word count chip next to the active section title (computed from `content` state; live).
  - Project total chip in the header, next to "AI calls" / mode selector (sum across `sections[].content`, updated optimistically as the active section edits).
  - `Draft ↔ Completed` toggle (shadcn `Switch` with label) that calls `updateProjectStatus` and refreshes.
- Word counter: shared `countWords(text)` helper in `src/lib/text.ts` (`text.trim().match(/\S+/g)?.length ?? 0`).

## 2. Voice everywhere

Reuse existing `<VoiceCapture />` (mic → STT → text). Extend to two modes:

- **Dictation** (default): raw transcript is appended to the target field.
- **Command**: transcript is sent to `runVoiceCommand` with a new `intent` hint; the returned JSON auto-fills fields.

Changes:
- `src/components/voice-capture.tsx`: add optional `mode: "dictation" | "command"` prop and a tiny inline toggle; `onTranscript` still fires for dictation, `onCommand(transcript)` fires for command mode.
- Mic buttons added:
  - Editor draft (already there) — keep, and add a second mic on the **Outline** field.
  - **Topics panel**: mic next to the "brief" input; dictation fills the brief.
  - **Journals panel**: mic next to the scope/keywords input; dictation fills it.
  - **Brainstorming panel** (new, see §3): mic for the area/keywords.
- **Extract-to-fields command** (`src/lib/ai/voice.functions.ts`): add `extractFromNarration({ project_id, transcript })` — one lean AI call returning strict JSON `{ topic, objectives, research_questions[], methodology, keywords[], notes }`. The client shows a small "Apply" panel letting the user push these into: project `context_notes`, section outline, or (if on Topics tab) a new pinned topic. Cheap prompt: title + doc_type + discipline + transcript only, not the whole document.

## 3. Brainstorming + topic extraction

- **New right-panel tab** `Brainstorm` (added as 6th tab, keeps existing five).
  - Inputs: broad area, optional keywords (typed or dictated).
  - New server fn `brainstormIdeas` in `src/lib/ai/topics.functions.ts` — one lean AI call, JSON `{ ideas[], problems[], questions[] }`. No new tables; results live in component state with a "Save selected as topics" button that reuses the existing `topics` insert path (small helper `insertTopics`).
- **Topic extraction** in the Topics panel:
  - New button "Extract from current section" — calls new `extractTopicFromText({ project_id, text })` server fn (lean prompt, uses only the active section content, capped to ~4k chars). Returns `{ implicit_topic, better_statements[], subtopics[] }`.
  - Same panel accepts a voice narration (mic reuses command mode → same server fn with the transcript).
  - Results render inline with "Pin as topic" buttons that reuse existing `togglePinTopic` flow (inserts via same table).

## 4. Citation style UX + save indicator

- **Header citation selector**: replace the read-only header text with a `<Select>` (APA / MLA / Chicago / IEEE) that calls a new `updateProjectCitationStyle({ id, citation_style })` server fn and invalidates the query. Because `ReferencesPanel` and the AI writing prompts already read `project.citation_style`, in-text citations, the reference list, and future AI outputs re-render/regenerate against the new style with no extra work.
- **Save indicator**: 
  - `projects.$id.tsx` tracks `saveState: "idle" | "dirty" | "saving" | "saved"`. `scheduleSave` sets `dirty`, the debounced call sets `saving` → `saved` (auto-fades to `idle` after 2 s).
  - Small status pill in the header (`Saved`, `Saving…`, `Unsaved changes`).
  - "Save now" button flushes the debounce timer and awaits the update immediately.

## 5. Intensive citations in Literature Review

- **UI**: when the active section's `key === "lit_review"` (or `key === "literature_review"` per `doc-templates`), show two extras above the AI actions:
  - Toggle: `Intensive citations` (persisted in component state; passed on next AI call).
  - Small note: "Uses your reference library ({n} refs) in {style} style."
- **Prompt** (`src/lib/ai/writing.functions.ts`):
  - Extend `runWritingAction` input with `intensive?: boolean` (default false). When true AND the section is the lit-review AND there are refs, fetch the project's refs, build a compact context block (cite_key, authors, year, title, container — no abstracts) and add a system instruction: "Weave multiple sources per paragraph using {citation_style} in-text form via the supplied cite keys; every claim needs at least one citation; produce synthesis, not per-source summaries; do not invent references beyond the provided list."
  - Client sends `intensive` from the toggle. Non-lit-review sections ignore it.
- Keeps low-credit vs advanced routing untouched (still `pickModel(project.mode)`).

## Files touched

- `src/routes/_authenticated/projects.$id.tsx` (header chips/toggle/select/save pill, mic additions, Brainstorm tab wiring, Lit-review toggle, topic extraction UI)
- `src/components/voice-capture.tsx` (dictation/command modes)
- `src/lib/projects.functions.ts` (`updateProjectStatus`, `updateProjectCitationStyle`)
- `src/lib/ai/voice.functions.ts` (`extractFromNarration`)
- `src/lib/ai/topics.functions.ts` (`brainstormIdeas`, `extractTopicFromText`, small `insertTopics` helper)
- `src/lib/ai/writing.functions.ts` (`intensive` flag + refs-aware lit-review prompt)
- `src/lib/text.ts` (new; `countWords`)
- One SQL migration (adds `projects.status`)

## Not touched

Auth, exports, Data Lab, submission assistant, other AI functions, all other tables, RLS.

## Test plan

1. Word counts update as you type; project total sums across sections.
2. Toggle status Draft ↔ Completed persists after refresh.
3. Mic on outline / topics brief / journals scope / brainstorm fills those fields via dictation.
4. Long narration in "command" mode extracts topic/objectives/RQs/methodology and previews an Apply panel.
5. Brainstorm tab returns ideas/problems/questions; selected items save as topics.
6. "Extract from current section" surfaces implicit topic + better statements + subtopics.
7. Changing citation style in header updates in-text and reference list live.
8. Saved / Saving… / Unsaved pill reflects state; "Save now" flushes immediately.
9. In Literature Review, enabling Intensive citations produces multi-source synthesis paragraphs using in-text citations in the current style, drawn from the project's reference library.
