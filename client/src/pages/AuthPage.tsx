import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowUpRight, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorBox } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Showcase() {
  return (
    <div className="relative hidden overflow-hidden border-r border-line lg:block">
      <div className="absolute inset-0" style={{ background: "radial-gradient(1000px 600px at 20% 10%, rgba(109,124,255,0.28), transparent 60%), radial-gradient(800px 500px at 90% 90%, rgba(56,189,248,0.22), transparent 60%), var(--surface)" }} aria-hidden />
      <div className="dot-grid absolute inset-0 opacity-70" aria-hidden />
      <div className="relative flex h-full flex-col justify-between p-12">
        <Logo />
        <div className="max-w-md space-y-8">
          <div>
            <h2 className="text-[40px] font-semibold leading-[1.1] tracking-tight">Know exactly where your <span className="brand-text">ad budget leaks.</span></h2>
            <p className="mt-4 text-base leading-relaxed text-ink-2">Bring your campaign data together, see what is profitable, and get clear, verified recommendations instead of spreadsheets.</p>
          </div>
          <ul className="space-y-3.5 text-sm">
            {[
              { Icon: Search, t: "Rules catch real problems", d: "Losing campaigns, CPC spikes, broken tracking." },
              { Icon: Sparkles, t: "AI explains, in plain language", d: "Based on your actual numbers, never guesses." },
              { Icon: ShieldCheck, t: "Every figure is verified", d: "Answers are checked against your data first." },
            ].map(({ Icon, t, d }) => (
              <li key={t} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface/70 text-accent-text backdrop-blur"><Icon className="size-4" aria-hidden /></span>
                <div><div className="font-medium">{t}</div><div className="text-ink-2">{d}</div></div>
              </li>
            ))}
          </ul>
        </div>
        {/* a small floating preview card */}
        <div className="max-w-sm rounded-2xl border border-line-strong bg-surface/80 p-4 shadow-pop backdrop-blur">
          <div className="flex items-center justify-between text-xs text-ink-2"><span>ROAS · last 30 days</span><Badge tone="good"><ArrowUpRight className="size-3" aria-hidden />+12.4%</Badge></div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">3.42×</div>
          <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="mt-2 h-10 w-full" aria-hidden>
            <defs><linearGradient id="showcase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d7cff" stopOpacity=".35" /><stop offset="1" stopColor="#6d7cff" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 30 L20 26 L40 28 L60 18 L80 22 L100 14 L120 17 L140 9 L160 12 L180 5 L200 8 L200 40 L0 40Z" fill="url(#showcase)" />
            <path d="M0 30 L20 26 L40 28 L60 18 L80 22 L100 14 L120 17 L140 9 L160 12 L180 5 L200 8" fill="none" stroke="#8b95ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { authed, login, register } = useAuth();
  const [f, setF] = useState({ email: "", password: "", name: "", workspaceName: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (authed) return <Navigate to="/" replace />;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") await login(f.email, f.password);
      else await register(f);
    } catch (err) {
      // Zod errors arrive as a list; we show the user the first readable message.
      setError(err instanceof ApiError && err.code === "VALIDATION_ERROR"
        ? new ApiError(400, err.code, err.details?.[0]?.message ?? err.message) : err);
    } finally { setBusy(false); }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <Showcase />
      <div className="relative grid place-items-center px-4 py-10">
        <div className="pointer-events-none absolute inset-0 lg:hidden" style={{ background: "radial-gradient(600px 300px at 50% 0%, var(--glow), transparent 70%)" }} aria-hidden />
        <div className="animate-fade-up relative w-full max-w-sm space-y-6">
          <div className="lg:hidden"><Logo /></div>
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Spendlens</h1>
            <p className="mt-1 text-sm text-ink-2">{mode === "login" ? "Log in to your account" : "Create an account and workspace"}</p>
          </div>
          <form onSubmit={submit} className="space-y-3.5">
            {mode === "register" && (
              <>
                <Field label="Name"><Input required value={f.name} onChange={set("name")} autoComplete="name" /></Field>
                <Field label="Workspace name (agency or company)">
                  <Input required value={f.workspaceName} onChange={set("workspaceName")} />
                </Field>
              </>
            )}
            <Field label="Email"><Input type="email" required value={f.email} onChange={set("email")} autoComplete="email" placeholder="you@company.com" /></Field>
            <Field label="Password">
              <Input type="password" required minLength={mode === "register" ? 8 : 1} value={f.password} onChange={set("password")}
                autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </Field>
            {error != null && <ErrorBox error={error} />}
            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
            </Button>
          </form>
          <p className="text-center text-sm text-ink-2">
            {mode === "login"
              ? <>No account yet? <Link className="font-medium text-accent-text hover:underline" to="/register">Sign up</Link></>
              : <>Already have an account? <Link className="font-medium text-accent-text hover:underline" to="/login">Log in</Link></>}
          </p>
        </div>
      </div>
    </div>
  );
}
