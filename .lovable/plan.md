# Auth reliability fix

## Diagnosis (what's actually wrong)

1. **Signup silently doesn't sign you in.** Email confirmation is on by default in Lovable Cloud. `/auth` calls `signUp` then toasts "You're signed in." Supabase returns `{ user, session: null }` because the email needs confirming — the user sees success, no session lands, next tab/refresh looks "logged out." This is the biggest reason "sign-up fails / session not recognised."
2. **No cross-tab / post-login router sync.** There is no root `onAuthStateChange` subscriber. Supabase syncs the session across tabs via `localStorage`, but the TanStack router never invalidates, so the second tab keeps showing the signed-out shell and the `_authenticated` gate (which only re-runs on navigation) doesn't re-evaluate.
3. **Auth page initial check uses `getUser()`** (network round-trip that can fail transiently in the preview iframe) instead of the local `getSession()`, so the redirect on load is flaky.
4. **Google OAuth `redirect_uri` is `window.location.origin`** — lands the user on `/` (the public landing), and only the `/auth` page's listener navigates to `/dashboard`. If the popup closes while the user is already on `/`, nothing routes them forward.
5. Site URL / redirect URLs: Lovable Cloud manages these automatically for `*.lovable.app` and the published domain. No manual config needed and none available via tooling — noting this so we don't chase a non-issue.

## Changes

### Backend config
- Call `supabase--configure_auth` with `auto_confirm_email: true` (keeps signup → immediate session, matches the MVP UX and avoids email-deliverability flakiness in previews). Signup, Google, and email are all already enabled.

### `src/routes/__root.tsx` — root auth listener
- Inside `RootComponent`, add a single `useEffect` that subscribes to `supabase.auth.onAuthStateChange`, filters to `SIGNED_IN | SIGNED_OUT | USER_UPDATED`, and calls `router.invalidate()` (plus `queryClient.invalidateQueries()` when not `SIGNED_OUT`). This is the canonical cross-tab + post-login sync and makes the `_authenticated` gate re-run automatically.

### `src/routes/auth.tsx` — tighten the page
- Use `supabase.auth.getSession()` (local, sync-ish) for the initial "already signed in?" check instead of `getUser()`.
- Keep the `onAuthStateChange` listener but let the root subscriber own router invalidation; here we just `navigate({ to: "/dashboard", replace: true })` on `SIGNED_IN`.
- Signup handler: if `data.session` is null after `signUp` (confirmation still required for any reason), show an explicit "Check your email to confirm" message instead of a false success toast.
- Google button: set `redirect_uri` to `${window.location.origin}/auth` so the popup/redirect returns to a page whose listener routes to `/dashboard` deterministically. Still a public same-origin URL (compliant with the OAuth guidance).

### `src/routes/_authenticated/route.tsx` — cheaper, more reliable gate
- Replace `supabase.auth.getUser()` (network) with `supabase.auth.getSession()` (local) for the redirect decision. `ssr: false` is already set. With the root listener calling `router.invalidate()`, the gate re-runs on real auth changes.

### `src/routes/index.tsx` — session-aware CTA (small polish)
- If a session exists, the "Sign in" / "Start writing" CTAs link to `/dashboard`. Prevents the "I'm signed in but the landing still says Sign in" confusion. Read via a tiny `useEffect` + local state; no new context/library.

## Explicitly NOT changing
- No new auth-context library, no Zustand/Jotai. Supabase client + the root listener + router context is enough.
- No changes to AI functions, DB schema, RLS, editor, exports, or projects code.
- No new routes, no `/auth/callback` page (Lovable's OAuth broker handles the round-trip; returning to `/auth` is sufficient).
- Not touching `client.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `start.ts` — already correct.

## Trade-offs
- Enabling `auto_confirm_email` removes the email verification step. For an MVP this is the standard Lovable Cloud recommendation; can be re-enabled later once transactional email is configured. Called out per user's ask.

## Test plan (after build)
1. Sign up with email+password → land on `/dashboard` immediately.
2. Sign out, sign back in → `/dashboard`.
3. Open the same preview URL in a second tab → dashboard renders without re-auth.
4. Hard refresh on `/dashboard` and on a project page → stays signed in.
5. Google sign-in from `/auth` → dashboard.

## Files touched
- `src/routes/__root.tsx`
- `src/routes/auth.tsx`
- `src/routes/_authenticated/route.tsx`
- `src/routes/index.tsx`
- Cloud auth setting via `supabase--configure_auth`
