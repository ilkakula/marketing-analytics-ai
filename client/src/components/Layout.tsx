import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, LogOut, Megaphone, Menu, Moon, Sun, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useWorkspace } from "@/hooks/queries";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone, end: false },
  { to: "/import", label: "Import", icon: UploadCloud, end: false },
];

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="grid size-8 place-items-center rounded-[10px] shadow-[0_6px_20px_-6px_#6d7cff]" style={{ background: "var(--brand)" }} aria-hidden>
        <svg viewBox="0 0 32 32" className="size-5"><path d="M15 8.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l5 5" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <span className="text-[17px] font-semibold tracking-tight">Spendlens</span>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { data: ws } = useWorkspace();
  const initials = (ws?.name ?? "A").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo className="px-2 pt-1" />
      <nav className="flex flex-col gap-1" aria-label="Main navigation">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-3 hover:text-ink")}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute -left-4 top-2 h-5 w-1 rounded-r-full" style={{ background: "var(--brand)" }} aria-hidden />}
                <Icon className={cn("size-[18px] transition-colors", isActive ? "text-accent-text" : "text-muted group-hover:text-ink-2")} aria-hidden />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-2">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: "var(--brand)" }} aria-hidden>{initials}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{ws?.name ?? "…"}</div>
            <div className="text-xs text-muted">Workspace</div>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="grid h-9 w-10 shrink-0 cursor-pointer place-items-center rounded-lg border border-line text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink">
            {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>
          <button type="button" onClick={logout}
            className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line text-sm text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink">
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface/80 backdrop-blur lg:block"><Sidebar /></aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/80 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button type="button" aria-label="Open menu" onClick={() => setOpen(true)} className="grid size-9 cursor-pointer place-items-center rounded-lg border border-line"><Menu className="size-5" aria-hidden /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface shadow-pop">
            <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded-lg text-ink-2 hover:bg-surface-3"><X className="size-4" aria-hidden /></button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="relative min-w-0">
        {/* soft brand glow behind the page header */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-72 overflow-hidden" aria-hidden>
          <div className="absolute -top-32 left-1/3 size-[520px] rounded-full opacity-70 blur-3xl [animation:glow-drift_16s_ease-in-out_infinite]" style={{ background: "radial-gradient(circle, var(--glow), transparent 65%)" }} />
          <div className="dot-grid absolute inset-0 opacity-60" />
        </div>
        <div className="relative mx-auto max-w-[1240px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><Outlet /></div>
      </main>
    </div>
  );
}
