import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type AuthorizationDetails = {
  client?: { name?: string; client_id?: string; redirect_uris?: string[] } | null;
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
};

type OAuthResult<T> = { data: T | null; error: { message: string } | null };
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult<AuthorizationDetails>>;
  approveAuthorization: (id: string) => Promise<OAuthResult<AuthorizationDetails>>;
  denyAuthorization: (id: string) => Promise<OAuthResult<AuthorizationDetails>>;
};

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

function isSameOriginPath(p: string): p is string {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//");
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      window.location.href = immediate;
    }
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Authorization error</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {(error as Error)?.message ?? String(error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData() as AuthorizationDetails | null;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void isSameOriginPath;

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an application";
  const scopes = details?.scopes ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Connect {clientName} to ScholarlyWrite AI</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This lets {clientName} use ScholarlyWrite AI as you — read and update your projects,
          sections, and references through your account.
        </p>
        {scopes.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {scopes.map((s) => (
              <li key={s} className="text-muted-foreground">• {s}</li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          This does not bypass ScholarlyWrite AI's permissions or backend policies.
        </p>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex gap-3">
          <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
            {busy ? "Please wait…" : "Approve"}
          </Button>
          <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>
            Deny
          </Button>
        </div>
      </div>
    </main>
  );
}
