import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileSpreadsheet, TriangleAlert, UploadCloud, X, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { ErrorBox } from "@/components/ui/states";
import { ImportHistory } from "@/components/ImportHistory";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ImportJob } from "@/lib/types";
import { PageHeader } from "./PageHeader";

const FIELD_LABEL: Record<string, string> = {
  date: "Date", campaign: "Campaign", spend: "Spend", impressions: "Impressions", clicks: "Clicks",
  conversions: "Conversions", revenue: "Revenue", ad_set: "Ad set (optional)", ad: "Ad (optional)",
};
const OPTIONAL_FIELDS = ["ad_set", "ad"];
const COLUMNS = ["date", "campaign", "ad_set", "ad", "spend", "impressions", "clicks", "conversions", "revenue"];

export function ImportPage() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);

  const upload = useMutation({
    mutationFn: (vars: { file: File; mapping: Record<string, string> }) => {
      const form = new FormData();
      form.append("file", vars.file);
      if (Object.keys(vars.mapping).length) form.append("mapping", JSON.stringify(vars.mapping));
      return api<ImportJob>("/api/imports/csv", { form });
    },
    // New data changes every report: invalidate the analytics cache.
    onSuccess: () => { for (const k of ["summary", "timeseries", "campaigns", "campaign", "imports"]) qc.invalidateQueries({ queryKey: [k] }); },
  });

  const choose = (f: File | null) => { setFile(f); setMapping({}); upload.reset(); };
  const err = upload.error instanceof ApiError ? upload.error : null;
  const missing: string[] | undefined = err?.details?.missing;
  const found: string[] = err?.details?.foundColumns ?? [];
  const job = upload.data;
  const step = job ? 3 : missing ? 2 : 1;

  return (
    <>
      <PageHeader title="Import data" subtitle="Upload a CSV export from your ad platform. One row per ad per day." showRange={false} />

      <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Progress">
        {["Choose file", "Map columns", "Review report"].map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={cn("grid size-6 place-items-center rounded-full text-[11px] font-bold transition-colors",
              i + 1 < step ? "bg-good-soft text-good" : i + 1 === step ? "text-white" : "bg-surface-3 text-muted")}
              style={i + 1 === step ? { background: "var(--brand)" } : undefined}>
              {i + 1 < step ? "✓" : i + 1}
            </span>
            <span className={i + 1 <= step ? "text-ink" : "text-muted"}>{s}</span>
            {i < 2 && <span className="mx-1 h-px w-8 bg-line-strong" aria-hidden />}
          </li>
        ))}
      </ol>

      <Card className="animate-fade-up">
        <CardBody className="space-y-5 pt-5">
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file"
            onChange={(e) => choose(e.target.files?.[0] ?? null)} />

          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) choose(f); }}
              className={cn("flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors",
                dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2")}>
              <div className="grid size-14 place-items-center rounded-2xl text-white shadow-[0_10px_30px_-10px_#6d7cff]" style={{ background: "var(--brand)" }}><UploadCloud className="size-7" aria-hidden /></div>
              <div>
                <p className="text-[15px] font-semibold">Drop your CSV here</p>
                <p className="mt-1 text-sm text-ink-2">or choose a file from your computer. Max 5 MB, up to 50,000 rows.</p>
              </div>
              <Button variant="brand" onClick={() => input.current?.click()}>Choose CSV file</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <span className="grid size-10 place-items-center rounded-lg bg-good-soft text-good"><FileSpreadsheet className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{file.name}</div>
                <div className="text-xs text-ink-2">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => choose(null)} aria-label="Remove file"><X className="size-4" aria-hidden /></Button>
              <Button variant="brand" disabled={upload.isPending} onClick={() => upload.mutate({ file, mapping })}>
                {upload.isPending ? "Importing…" : "Import"}
              </Button>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-ink-2">Expected columns</p>
            <div className="flex flex-wrap gap-1.5">
              {COLUMNS.map((c) => <Badge key={c} tone={OPTIONAL_FIELDS.includes(c) ? "neutral" : "accent"}>{c}{OPTIONAL_FIELDS.includes(c) ? " (optional)" : ""}</Badge>)}
            </div>
          </div>

          {err && !missing && <ErrorBox error={err} />}

          {missing && (
            <div className="space-y-4 rounded-2xl border border-warn/30 bg-warn-soft p-4">
              <p className="flex items-start gap-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                <span>{err!.message}. Map the columns from your file to the required fields.</span></p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...missing, ...OPTIONAL_FIELDS].map((m) => (
                  <Field key={m} label={FIELD_LABEL[m] ?? m}>
                    <Select value={mapping[m] ?? ""}
                      onChange={(e) => {
                        // An empty choice removes the entry, so the server never receives a blank mapping.
                        const { [m]: _drop, ...rest } = mapping;
                        setMapping(e.target.value ? { ...rest, [m]: e.target.value } : rest);
                      }}>
                      <option value="">{OPTIONAL_FIELDS.includes(m) ? "— none —" : "— choose a column —"}</option>
                      {found.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
              <Button variant="brand" disabled={missing.some((m) => !mapping[m]) || upload.isPending}
                onClick={() => file && upload.mutate({ file, mapping })}>Import with mapping</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {job && <ImportReport job={job} />}
      <ImportHistory />
    </>
  );
}

function ImportReport({ job }: { job: ImportJob }) {
  const ok = job.status === "completed";
  const failed = job.status === "failed";
  const Icon = ok ? CheckCircle2 : failed ? XCircle : TriangleAlert;
  const title = ok ? "Import finished" : failed ? "Import failed: no row is valid" : "Import finished with errors";
  const tone = ok ? "text-good" : failed ? "text-bad" : "text-warn";
  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className={cn("size-5", tone)} aria-hidden /> {title}</CardTitle>
        {!failed && <Link to="/" className="text-sm font-medium text-accent-text hover:underline">Open overview →</Link>}
      </CardHeader>
      <CardBody className="space-y-5">
        <dl className="grid grid-cols-3 gap-3">
          {([["Total rows", job.totalRows, ""], ["Imported", job.rowsImported, "text-good"], ["Rejected", job.rowsFailed, job.rowsFailed ? "text-bad" : ""]] as const).map(([k, v, c]) => (
            <div key={k} className="rounded-xl border border-line bg-surface-2 p-4">
              <dt className="text-xs text-ink-2">{k}</dt>
              <dd className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", c)}>{v.toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
        {job.errors.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-2">
                <tr><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Column</th><th className="px-3 py-2 font-medium">Problem</th></tr>
              </thead>
              <tbody>
                {job.errors.map((e, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2 tabular-nums">{e.row}</td>
                    <td className="px-3 py-2 text-ink-2">{e.column ?? "—"}</td>
                    <td className="px-3 py-2">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {job.errorsTruncated && <p className="text-xs text-ink-2">Showing the first {job.errors.length} of {job.rowsFailed} errors.</p>}
      </CardBody>
    </Card>
  );
}
