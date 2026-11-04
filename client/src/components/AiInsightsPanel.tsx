import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertOctagon, AlertTriangle, Lightbulb, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useRange } from "@/lib/dateRange";
import { cn } from "@/lib/cn";
import type { AiFinding, AiResult, Notice } from "@/lib/types";

const NOTICE: Record<Notice, string> = {
  NO_API_KEY: "No AI model is configured, showing the rule-based findings.",
  RATE_LIMITED: "The AI analysis limit for this hour has been reached, showing the rule-based findings.",
  LLM_UNAVAILABLE: "The AI model is currently unavailable, showing the rule-based findings.",
  LLM_REJECTED: "The AI answer failed the number accuracy check, showing the rule-based findings.",
  NO_DATA: "There is no data for the selected period.",
};

// Severity: icon + text + tint, never color alone.
const SEVERITY = {
  high: { label: "High priority", Icon: AlertOctagon, chip: "bg-bad-soft text-bad", ring: "border-bad/25" },
  medium: { label: "Medium priority", Icon: AlertTriangle, chip: "bg-warn-soft text-warn", ring: "border-warn/25" },
  info: { label: "Opportunity", Icon: Lightbulb, chip: "bg-good-soft text-good", ring: "border-good/25" },
} as const;

const STEPS = ["Computing findings from your data…", "Asking the model to explain them…", "Verifying every number against your data…"];

function Finding({ f }: { f: AiFinding }) {
  const { label, Icon, chip, ring } = SEVERITY[f.severity];
  return (
    <li className={cn("flex gap-3 rounded-xl border bg-surface-2 p-3.5 text-sm transition-colors hover:bg-surface-3", ring)}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", chip)}><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0">
        <div className="mb-0.5 flex items-center gap-2 text-xs">
          <span className="font-semibold text-ink-2">{f.id}</span>
          <span className={cn("rounded-full px-2 py-0.5 font-semibold", chip)}>{label}</span>
        </div>
        <p className="leading-relaxed text-ink">{f.message}</p>
      </div>
    </li>
  );
}

function Loading() {
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2200); return () => clearInterval(t); }, []);
  return (
    <div role="status" className="space-y-4">
      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1.5 transition-colors", i <= step ? "text-ink" : "text-muted")}>
            <span className={cn("size-1.5 rounded-full", i < step ? "bg-good" : i === step ? "animate-pulse bg-accent-text" : "bg-line-strong")} aria-hidden />{s}
          </li>
        ))}
      </ol>
      <Skeleton className="h-5 w-4/5" /><Skeleton className="h-5 w-3/5" />
      <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
    </div>
  );
}

export function AiInsightsPanel() {
  const { range } = useRange();
  const analyze = useMutation({
    mutationFn: () => api<AiResult>("/api/ai/insights", { json: { from: range.from, to: range.to } }),
  });
  // A different period means a different analysis; the old result would be misleading.
  useEffect(() => { analyze.reset(); }, [range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = analyze.data;
  return (
    <section className="brand-border animate-fade-up" aria-label="AI insights">
      <div className="relative overflow-hidden rounded-[calc(1.1rem-1px)] bg-surface">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-60 blur-3xl" style={{ background: "radial-gradient(circle, var(--glow), transparent 65%)" }} aria-hidden />
        <div className="relative space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl text-white shadow-[0_8px_24px_-8px_#6d7cff]" style={{ background: "var(--brand)" }}><Sparkles className="size-5" aria-hidden /></span>
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight">AI insights</h2>
                <p className="text-xs text-ink-2">Rules find the problems, the model explains them, every number is verified.</p>
              </div>
            </div>
            <Button variant="brand" size="lg" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
              <Sparkles className={cn("size-4", analyze.isPending && "animate-pulse")} aria-hidden />
              {analyze.isPending ? "Analyzing…" : r ? "Analyze again" : "Analyze period"}
            </Button>
          </div>

          {!r && !analyze.isPending && !analyze.error && (
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { Icon: Search, t: "Finds real problems", d: "Campaigns losing money, CPC spikes, conversion drops, runaway budgets." },
                { Icon: Sparkles, t: "Explains them clearly", d: "Plain-language findings and recommendations based on your actual data." },
                { Icon: ShieldCheck, t: "Never invents numbers", d: "Every figure in the answer is checked against your data before you see it." },
              ].map(({ Icon, t, d }) => (
                <div key={t} className="rounded-xl border border-line bg-surface-2 p-4">
                  <Icon className="mb-2 size-4 text-accent-text" aria-hidden />
                  <div className="text-sm font-medium">{t}</div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">{d}</p>
                </div>
              ))}
            </div>
          )}
          {analyze.isPending && <Loading />}
          {analyze.error != null && <ErrorBox error={analyze.error} />}

          {r && (
            <div className="space-y-6 animate-fade-up">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {r.source === "llm"
                  ? <Badge tone="good"><ShieldCheck className="size-3" aria-hidden /> Numbers verified</Badge>
                  : <Badge tone="warn">Rules only</Badge>}
                <Badge tone="neutral">{r.source === "llm" ? `AI model: ${r.model}` : "Rules (no AI model)"}</Badge>
                {r.cached && <span className="text-muted">from cache</span>}
                {r.notice && <span role="note" className="text-ink-2">{NOTICE[r.notice]}</span>}
              </div>

              <p className="max-w-4xl text-[17px] font-medium leading-relaxed tracking-tight">{r.insights.summary}</p>

              {r.insights.recommendations.length > 0 && (
                <section aria-labelledby="rec">
                  <h3 id="rec" className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-2">Recommendations</h3>
                  <ol className="grid gap-3 md:grid-cols-2">
                    {r.insights.recommendations.map((x, i) => (
                      <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm transition-colors hover:border-line-strong">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-text">{i + 1}</span>
                        <div>
                          <div className="font-medium leading-snug">{x.action}</div>
                          <div className="mt-1 leading-relaxed text-ink-2">{x.reason}</div>
                          {x.basedOn.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">Based on: {x.basedOn.map((id) => <Badge key={id} tone="neutral">{id}</Badge>)}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {r.insights.observations.length > 0 && (
                <section aria-labelledby="obs">
                  <h3 id="obs" className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-2">Observations</h3>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2 marker:text-muted">{r.insights.observations.map((o, i) => <li key={i}>{o}</li>)}</ul>
                </section>
              )}

              {r.findings.length > 0 && (
                <section aria-labelledby="fnd">
                  <h3 id="fnd" className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-2">Findings from the data (evidence)</h3>
                  <ul className="grid gap-2.5 md:grid-cols-2">{r.findings.map((f) => <Finding key={f.id} f={f} />)}</ul>
                </section>
              )}
              <p className="text-xs text-muted">The data shows correlation, not cause: recommendations are guidance to check, not a guarantee of outcome.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
