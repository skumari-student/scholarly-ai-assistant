
-- Uploads table
CREATE TABLE public.uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  section_id uuid REFERENCES public.sections(id) ON DELETE SET NULL,
  path text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'file',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploads TO authenticated;
GRANT ALL ON public.uploads TO service_role;

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own uploads"
  ON public.uploads
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER uploads_touch_updated_at
  BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Journal suggestion URL
ALTER TABLE public.journal_suggestions ADD COLUMN IF NOT EXISTS url text;

-- Storage RLS for project-uploads bucket (path convention: <user_id>/<project_id>/<file>)
CREATE POLICY "Users read their uploads"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'project-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users write their uploads"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'project-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users update their uploads"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'project-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete their uploads"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'project-uploads' AND (storage.foldername(name))[1] = auth.uid()::text);
