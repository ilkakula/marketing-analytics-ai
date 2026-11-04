import { Link } from "react-router-dom";
import { Inbox, UploadCloud } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "./button";

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div role="status" className="py-10 text-center text-sm text-ink-2">{label}</div>
);

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
  return <div role="alert" className="rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-ink">{msg}</div>;
}

export const EmptyData = () => (
  <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
    <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text"><Inbox className="size-6" aria-hidden /></div>
    <div>
      <p className="text-[15px] font-semibold">No data for this period</p>
      <p className="mt-1 text-sm text-ink-2">There is no data for the selected period. Import a CSV to get started.</p>
    </div>
    <Link to="/import"><Button variant="brand"><UploadCloud className="size-4" aria-hidden /> Import CSV</Button></Link>
  </div>
);
