import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, LogOut, LayoutDashboard, PlusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4 font-semibold">
          <BookOpen className="h-5 w-5" /> ScholarlyWrite
        </div>
        <nav className="flex-1 space-y-1 p-3 text-sm">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent"
            activeProps={{ className: "bg-accent" }}
          >
            <LayoutDashboard className="h-4 w-4" /> Dashboard
          </Link>
          <Link
            to="/projects/new"
            className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-accent"
            activeProps={{ className: "bg-accent" }}
          >
            <PlusCircle className="h-4 w-4" /> New Project
          </Link>
        </nav>
        <div className="border-t border-border p-3">
          <Button variant="ghost" className="w-full justify-start" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
