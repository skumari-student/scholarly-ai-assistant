CREATE TABLE public.project_visuals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  user_id uuid not null,
  kind text not null,
  title text not null,
  caption text,
  payload jsonb not null default '{}'::jsonb,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_visuals TO authenticated;
GRANT ALL ON public.project_visuals TO service_role;
ALTER TABLE public.project_visuals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own project_visuals" ON public.project_visuals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX project_visuals_project_idx ON public.project_visuals(project_id, "order");
CREATE TRIGGER project_visuals_touch_updated_at
  BEFORE UPDATE ON public.project_visuals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();