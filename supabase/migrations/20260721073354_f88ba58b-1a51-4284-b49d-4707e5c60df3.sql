
-- datasets
CREATE TABLE public.datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  upload_id uuid REFERENCES public.uploads(id) ON DELETE SET NULL,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'upload',
  kind text NOT NULL DEFAULT 'quant',
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  sample jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datasets TO authenticated;
GRANT ALL ON public.datasets TO service_role;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own datasets" ON public.datasets FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER datasets_touch BEFORE UPDATE ON public.datasets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- journal_cache
CREATE TABLE public.journal_cache (
  issn text PRIMARY KEY,
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.journal_cache TO authenticated;
GRANT ALL ON public.journal_cache TO service_role;
ALTER TABLE public.journal_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read journal cache" ON public.journal_cache FOR SELECT
  TO authenticated USING (true);

-- journal_shortlist
CREATE TABLE public.journal_shortlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  issn text NOT NULL,
  title text NOT NULL,
  publisher text,
  homepage text,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'considering',
  "order" integer NOT NULL DEFAULT 0,
  fit jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, issn)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_shortlist TO authenticated;
GRANT ALL ON public.journal_shortlist TO service_role;
ALTER TABLE public.journal_shortlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own shortlist" ON public.journal_shortlist FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER shortlist_touch BEFORE UPDATE ON public.journal_shortlist
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- submissions
CREATE TABLE public.submissions (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  target_issn text,
  target_title text,
  cover_letter text NOT NULL DEFAULT '',
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  package jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submissions TO authenticated;
GRANT ALL ON public.submissions TO service_role;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own submission" ON public.submissions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER submissions_touch BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
