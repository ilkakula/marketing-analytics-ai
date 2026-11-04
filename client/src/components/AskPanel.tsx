import { useRef, useState, type FormEvent } from "react";
import { ArrowUp, Database, MessageSquareText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { useRange } from "@/lib/dateRange";
import { cn } from "@/lib/cn";
import { longDate } from "@/lib/format";
import type { AskNotice, AskResult } from "@/lib/types";

const SUGGESTIONS = [
  "Which campaign is losing money?",
  "How did ROAS change compared with the previous period?",
  "Which campaign has the best ROAS?",
  "What should I look at first?",
];

const TOOL_LABEL: Record<string, string> = {
  get_summary: "Summary", get_trend: "Trend", list_campaigns: "Campaign list", get_campaign_details: "Campaign details", get_findings: "Findings",
};
const NOTICE: Record<AskNotice, string> = {
  NO_API_KEY: "No AI model is configured, showing the rule-based summary instead.",
  RATE_LIMITED: "The question limit for this hour has been reached, showing the rule-based summary instead.",
  LLM_UNAVAILABLE: "The AI model is currently unavailable, showing the rule-based summary instead.",
  LLM_REJECTED: "The answer failed verification, so it is not shown. Here is the rule-based summary instead.",
  NO_DATA: "There is no data yet.",
};

interface Exchange { id: number; question: string; period: string; result?: AskResult; error?: string }

export function AskPanel() {
  const { range } = useRange();
  const [thread, setThread] = useState<Exchange[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);

  async function submit(question: string) {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    const id = nextId.current++;
    const period = range.from && range.to ? `${longDate(range.from)} – ${longDate(range.to)}` : "All time";
    setThread((t) => [{ id, question: q, period }, ...t].slice(0, 5));
    setText(""); setBusy(true);
    try {
      const result = await api<AskResult>("/api/ai/ask", { json: { question: q, from: range.from, to: range.to } });
      setThread((t) => t.map((x) => (x.id === id ? { ...x, result } : x)));
    } catch (e) {
      setThread((t) => t.map((x) => (x.id === id ? { ...x, error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." } : x)));
    } finally { setBusy(false); }
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void submit(text); };

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent-text"><MessageSquareText className="size-[18px]" aria-hidden /></span>
          <div>
            <CardTitle>Ask your data</CardTitle>
            <p className="text-xs text-ink-2">Ask in plain English. The model can only read your data through a few safe tools, and every number is verified.</p>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface-2 p-1.5 pl-4 transition-colors focus-within:border-accent focus-within:outline-2 focus-within:outline-accent/30">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Your question" placeholder="e.g. Which campaign should I pause first?"
            className="h-9 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
          <button type="submit" disabled={busy || text.trim().length < 3} aria-label="Ask"
            className="grid size-9 cursor-pointer place-items-center rounded-lg text-white transition-all enabled:hover:brightness-110 enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--brand)" }}>
            <ArrowUp className="size-4" aria-hidden />
          </button>
        </form>

        {thread.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void submit(s)} disabled={busy}
                className="cursor-pointer rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        )}

        <ul className="space-y-5">
          {thread.map((x) => (
            <li key={x.id} className="animate-fade-up space-y-2.5">
              <div className="flex items-start justify-end gap-2">
                <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-accent-soft px-3.5 py-2 text-sm text-ink">{x.question}</p>
              </div>
              <div className="rounded-2xl rounded-tl-md border border-line bg-surface-2 p-4">
                {x.error ? (
                  <p role="alert" className="text-sm text-bad">{x.error}</p>
                ) : !x.result ? (
                  <div role="status" className="space-y-2" aria-label="Looking at your data">
                    <p className="text-xs text-ink-2">Looking at your data…</p><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{x.result.answer}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {x.result.verified
                        ? <Badge tone="good"><ShieldCheck className="size-3" aria-hidden /> Numbers verified</Badge>
                        : <Badge tone="warn">Rules only</Badge>}
                      {x.result.steps.length > 0 && (
                        <span className="flex flex-wrap items-center gap-1.5 text-muted">
                          <Database className="size-3" aria-hidden /> Looked at:
                          {x.result.steps.map((s, i) => <Badge key={i} tone={s.ok ? "neutral" : "warn"}>{TOOL_LABEL[s.tool] ?? s.tool}</Badge>)}
                        </span>
                      )}
                      <span className="text-muted">Period: {x.period}</span>
                      {x.result.cached && <span className="text-muted">from cache</span>}
                    </div>
                    {x.result.notice && <p role="note" className={cn("text-xs", x.result.notice === "NO_DATA" ? "text-ink-2" : "text-warn")}>{NOTICE[x.result.notice]}</p>}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {thread.length > 0 && !busy && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.filter((s) => !thread.some((x) => x.question === s)).slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => void submit(s)}
                className="cursor-pointer rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-line-strong hover:text-ink">{s}</button>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
