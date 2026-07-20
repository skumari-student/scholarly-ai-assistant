# ScholarlyWrite AI — Phase 1 MVP Plan

A lean academic writing workspace with AI drafting, references, voice dictation + commands, topic and journal suggestions, and export. Google + email login, cloud-saved projects.

## Scope (this build)

- Auth (email/password + Google), cloud-saved projects per user
- Dashboard: New Project, My Projects
- New Project wizard (type, discipline, citation style, language level)
- Structured writing workspace with section templates per document type
- AI actions: outline, draft, expand, condense, academic tone, coherence, redundancy check
- Literature manager (manual add + BibTeX paste) with in-text citations and formatted reference list (APA, MLA, Chicago, IEEE)
- Topic ideation panel (batched AI generation)
- Publication planner (AI-generated journal suggestions, verify-yourself disclaimer)
- Voice Assistant: dictation (STT) into active section + conversational commands ("summarize methodology", "improve introduction")
- Export: DOCX, PDF, Markdown (full document or single section)
- Low-credit vs Advanced mode toggle; per-project AI-call counter

Out of scope this phase: Data Lab, Scopus/journal DB, submission assistant, LaTeX export, PDF metadata extraction, spoken TTS replies, tool generator.

## Screens

- `/` public landing with sign-in CTA
- `/auth` email/password + Google
- `/_authenticated/dashboard` project list + New Project
- `/_authenticated/projects/new` wizard (with voice narration onboarding)
- `/_authenticated/projects/$id` writing workspace (sections sidebar, editor, right panel tabs: AI actions, References, Voice, Topics, Journals, Usage)
- `/_authenticated/projects/$id/export` export options

## Data model (Lovable Cloud)

- `profiles` (id → auth.users, display_name)
- `projects` (id, user_id, title, doc_type, discipline, citation_style, language_level, mode, created_at)
- `sections` (id, project_id, key, title, order, content, outline)
- `references` (id, project_id, csl_json, cite_key)
- `citations` (id, section_id, reference_id, position)
- `topics` (id, project_id, title, description, rq, pinned)
- `journal_suggestions` (id, project_id, name, scope, requirements, pinned)
- `voice_transcripts` (id, project_id, section_id nullable, text, created_at)
- `ai_usage` (id, project_id, kind, tokens, created_at)

RLS: owner-only on all tables via `auth.uid() = user_id` (join through project for children). Standard GRANTs to authenticated + service_role.

## Backend (TanStack server functions)

All AI calls server-side via Lovable AI Gateway (`google/gemini-3.5-flash` default; `google/gemini-3.1-pro-preview` for Advanced mode). Grouped modules:

- `ai/writing.functions.ts` — outline, draft, refine actions (context = project meta + section outline + relevant refs, not full doc)
- `ai/topics.functions.ts` — batched topic list generation
- `ai/journals.functions.ts` — journal suggestion generation
- `ai/voice.functions.ts` — conversational commands (summarize, critique)
- `stt.functions.ts` — proxy audio upload to `openai/gpt-4o-mini-transcribe` (streaming SSE)
- `references.functions.ts` — CRUD + citation-style formatting (server-side CSL rendering with `citeproc` or simple templated formatter for the 4 styles)
- `export.functions.ts` — DOCX (docx-js), PDF (server render), Markdown

Credit efficiency: cache last outline/refine result per section; strip full doc from prompts, send only current section + outline + selected refs; increment `ai_usage` on each call.

## Voice

- Browser: record via Web Audio API → encode WAV (16kHz mono) → upload to `/api/stt` server route (streams SSE back)
- Dictation mode: append transcript into active section
- Command mode: send transcript + section context to `ai/voice.functions.ts`, render response in Voice panel

## Tech notes

- Enable Lovable Cloud (Supabase) with email + Google (`supabase--configure_social_auth`)
- Ensure `LOVABLE_API_KEY` via `ai_gateway--create`
- Rich text: Tiptap editor per section
- Export: `docx` npm package for DOCX; server HTML→PDF for PDF; string builder for MD
- Minimal shadcn UI, sidebar layout, no heavy animation

## Deliverables

Working end-to-end: sign up → create project → dictate/type → generate outline & draft → add references → cite → get topic + journal suggestions → export DOCX/PDF/MD. AI usage counter visible per project.

## Confirm before I build

Ready to proceed with this scope, or trim/extend anything (e.g. drop journal planner or PDF export from MVP)?
