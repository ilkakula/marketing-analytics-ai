import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBox } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useImports } from "@/hooks/queries";
import { api } from "@/lib/api";
import type { ImportHistoryItem } from "@/lib/types";

const STATUS: Record<ImportHistoryItem["status"], { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  completed: { label: "Completed", tone: "good" },
  completed_with_errors: { label: "With errors", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  undone: { label: "Deleted", tone: "neutral" },
};

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function ImportHistory() {
  const qc = useQueryClient();
  const { data, error } = useImports();
  const [confirming, setConfirming] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api<{ deletedRows: number }>(`/api/imports/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirming(null);
      // The data changed, so every report (and the history itself) is stale.
      for (const k of ["summary", "timeseries", "campaigns", "campaign", "imports"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent-soft text-accent-text"><History className="size-[18px]" aria-hidden /></span>
          <div>
            <CardTitle>Import history</CardTitle>
            <p className="text-xs text-ink-2">Deleting an import removes the rows it currently owns. Rows overwritten by a later import belong to that one.</p>
          </div>
        </div>
      </CardHeader>
      <CardBody className="space-y-2">
        {error != null && <ErrorBox error={error} />}
        {remove.error != null && <ErrorBox error={remove.error} />}
        {!data ? (
          error ? null : <><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-2">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((i) => {
              const st = STATUS[i.status];
              const canDelete = (i.status === "completed" || i.status === "completed_with_errors") && i.rowsOwned > 0;
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{i.filename}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-2">
                      {when(i.createdAt)} · {i.rowsImported.toLocaleString("en-US")} imported
                      {i.rowsFailed > 0 && ` · ${i.rowsFailed.toLocaleString("en-US")} rejected`}
                      {i.status !== "undone" && i.status !== "failed" && ` · ${i.rowsOwned.toLocaleString("en-US")} rows currently owned`}
                    </div>
                  </div>
                  {canDelete && (confirming === i.id ? (
                    <div className="flex items-center gap-2 text-sm" role="alertdialog" aria-label="Confirm deletion">
                      <span className="text-ink-2">Delete {i.rowsOwned.toLocaleString("en-US")} rows?</span>
                      <Button size="sm" variant="outline" className="border-bad/40 text-bad" disabled={remove.isPending} onClick={() => remove.mutate(i.id)}>
                        {remove.isPending ? "Deleting…" : "Delete"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => { remove.reset(); setConfirming(i.id); }} aria-label={`Delete import ${i.filename}`}>
                      <Trash2 className="size-4" aria-hidden /> Delete data
                    </Button>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
