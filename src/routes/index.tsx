import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Mic, Quote, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ScholarlyWrite AI — Plan, draft, and cite academic work" },
      {
        name: "description",
        content:
          "An AI-assisted workspace for researchers and students to plan, draft, cite, and export scholarly writing.",
      },
      { property: "og:title", content: "ScholarlyWrite AI" },
      { property: "og:description", content: "Draft, cite, and refine academic work with AI." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  const ctaTo = signedIn ? "/dashboard" : "/auth";
  const ctaLabel = signedIn ? "Open dashboard" : "Sign in";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <BookOpen className="h-5 w-5" />
            ScholarlyWrite AI
          </div>
          <Link
            to={ctaTo}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {ctaLabel}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="max-w-3xl">
          <h1 className="text-5xl font-semibold leading-tight tracking-tight">
            Plan, draft, and cite scholarly work — with an AI co-author.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            A lean, credit-efficient workspace for researchers, faculty, and students. Draft with AI,
            manage references, dictate by voice, and export clean documents in the citation style you need.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              to="/auth"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Start writing
            </Link>
          </div>
        </section>

        <section className="mt-20 grid gap-6 md:grid-cols-4">
          {[
            { icon: Sparkles, title: "Structured drafting", body: "Outline first, then draft. Refine per section." },
            { icon: Quote, title: "Citations that stick", body: "APA, MLA, Chicago, IEEE — updated everywhere." },
            { icon: Mic, title: "Voice assistant", body: "Dictate, then ask for critique and improvements." },
            { icon: BookOpen, title: "Export ready", body: "DOCX and Markdown, full doc or single sections." },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border border-border p-5">
              <f.icon className="h-5 w-5 text-primary" />
              <div className="mt-3 font-medium">{f.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{f.body}</div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
