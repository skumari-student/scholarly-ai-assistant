## 1) Export: reliability + PDF + scope + status

**Root cause of "PDF fails":** the current export server function only supports `md` and `docx` (see `src/lib/export.functions.ts`), and the export page (`projects.$id.export.tsx`) only exposes DOCX / Markdown buttons. There is no PDF path today — the "no file" outcome for PDF is simply an unimplemented format.

Fixes:
- Extend `exportProject` to accept `format: "md" | "docx" | "pdf"` and `scope: "full" | "section"` plus optional `section_id`. Always re-load latest sections + refs at call time (already does) and use the project's saved `citation_style`.
- **PDF**: generate client-side to keep it credit-free and dependency-light. Build a printable HTML view (title, sections, references formatted via existing `formatReferenceList`) and hand it to the browser's print pipeline (`window.print()` on a hidden iframe with `@media print` styles). No new server dep, works everywhere.
- **DOCX / MD**: keep server generation; add a "Draft" footer/watermark when the project status is `draft` and the user picks "Draft version" (DOCX: page footer "DRAFT — not for distribution"; MD: prepend `> DRAFT — not for distribution`; PDF: watermark via print CSS).
- Rebuild the Export page UI: format dropdown, scope dropdown (Full document / Current section), section picker (enabled only when scope=section), a "Version" toggle (Draft / Final, defaulted from project status), a spinner + toast on start/success/failure, and a visible current status badge + citation style.
- Also add a small "Export" menu (DOCX/PDF/MD, full or current section) inside the editor header so single-section export is one click from the workspace.

## 2) Uploads / Library / Gallery

- Storage: create a private bucket `project-uploads` with RLS scoped to `auth.uid()` as the first path segment.
- New table `public.uploads`: `id`, `project_id`, `user_id`, `section_id` (nullable), `path` (storage key), `name`, `mime`, `size`, `kind` ('image' | 'file'), `created_at`. RLS: owner-only via `project_id → projects.user_id`. GRANTs for authenticated + service_role.
- Server functions in `src/lib/uploads.functions.ts`: `listUploads(project_id)`, `signUpload(project_id, name, mime, size)` → returns a signed upload URL + row insert, `deleteUpload(id)`, `attachUploadToSection(id, section_id | null)`, `getSignedUrl(id)` for viewing.
- New "Library" tab in the editor workspace (`projects.$id.tsx`): drag/drop or file input upload, gallery grid of image thumbnails (signed URLs) + list rows for other files with name/size/type. Per-item actions: attach to current section, detach, delete, copy Markdown snippet (`![alt](signed-url)` for images, `[name](signed-url)` for files) to paste into the editor.
- Keep it lean: no cropping, no editing, no PDF text extraction.

## 3) Journal links

- Migration: `ALTER TABLE public.journal_suggestions ADD COLUMN url text;`
- Update `generateJournals` prompt + JSON schema to include a `url` (likely publisher home / journal landing page). Truncate to 300 chars. Keep the existing "verify on the venue's website" note.
- JournalsPanel row: add a **"Verify on journal's website ↗"** link (opens `j.url` in a new tab, `rel="noopener noreferrer"`); fall back to a Google Scholar query URL when the model omits one.

## Constraints respected

- No auth changes, no changes to the writing/AI action pipeline, no changes to `projects` schema (status field already exists and is reused).
- New surface area is limited to: one migration (uploads table + journal url column), one new storage bucket, one new server-function file, one new tab, and the rewritten export page + editor export menu.

## Technical details

**Files created**
- `src/lib/uploads.functions.ts` — signed-upload / list / delete / attach.
- Possibly a small `src/components/print-export.ts` helper for the PDF (hidden iframe + print).

**Files edited**
- `src/lib/export.functions.ts` — add `scope`, `section_id`, optional `draft` flag, draft footer/prefix for DOCX/MD; keep same response shape.
- `src/routes/_authenticated/projects.$id.export.tsx` — new UI (format + scope + version + section picker + status badge + progress/error).
- `src/routes/_authenticated/projects.$id.tsx` — Library tab, editor-header export menu, journal link rendering.
- `src/lib/ai/journals.functions.ts` — include `url` in schema + insert.

**Migrations (single call)**
- `CREATE TABLE public.uploads (...)` + GRANTs + RLS + owner policy + `updated_at` trigger reuse.
- `ALTER TABLE public.journal_suggestions ADD COLUMN url text;`
- Storage bucket `project-uploads` (private) via `supabase--storage_create_bucket`, then RLS policies on `storage.objects` in a migration: users may `SELECT/INSERT/UPDATE/DELETE` where `bucket_id = 'project-uploads' AND (storage.foldername(name))[1] = auth.uid()::text`.

**PDF approach — why client-side print**
Server-rendered PDF on Cloudflare Workers rules out `puppeteer`/`chromium`. `pdf-lib` / `jspdf` on the server work but need font embedding for arbitrary user text and add bundle weight. The browser already renders our formatted HTML perfectly and users get native "Save as PDF" plus real page breaks and selectable text — zero credits, zero new deps.
