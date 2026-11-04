import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { download } from "@/lib/api";

export function ExportButton({ query }: { query: Record<string, string | number | undefined> }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <Button variant="outline" disabled={state === "busy"} title={state === "error" ? "Export failed, please try again" : undefined}
      onClick={async () => {
        setState("busy");
        try { await download("/api/exports/csv", query); setState("idle"); } catch { setState("error"); }
      }}>
      {state === "busy" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
      {state === "busy" ? "Exporting…" : state === "error" ? "Error, try again" : "Export CSV"}
    </Button>
  );
}
