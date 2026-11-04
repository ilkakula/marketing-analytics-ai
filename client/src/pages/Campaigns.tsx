import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitCompareArrows, Search } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";
import { MetricsTable } from "@/components/CampaignTable";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyData, ErrorBox } from "@/components/ui/states";
import { useCampaigns } from "@/hooks/queries";
import { useRange } from "@/lib/dateRange";
import { PageHeader } from "./PageHeader";

const MAX_COMPARE = 4;

export function Campaigns() {
  const { range } = useRange();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<{ by: string; order: "asc" | "desc" }>({ by: "spend", order: "desc" });
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Do not send a request on every keystroke.
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const q = useCampaigns({ search: debounced, sortBy: sort.by, order: sort.order, page, pageSize });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / pageSize)) : 1;

  return (
    <>
      <PageHeader title="Campaigns" subtitle={q.data ? `${q.data.total} campaigns` : undefined}
        actions={<ExportButton query={{ from: range.from, to: range.to, search: debounced, sortBy: sort.by, order: sort.order }} />} />
      <Card className="animate-fade-up">
        <CardBody className="space-y-3 px-2">
          <div className="flex flex-wrap items-center gap-3 px-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input className="pl-9" placeholder="Search campaigns…" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {selected.size > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-accent-soft py-1 pl-3 pr-1 text-sm" role="status">
                <span className="text-accent-text">Selected {selected.size} of at most {MAX_COMPARE}</span>
                <Button size="sm" disabled={selected.size < 2} onClick={() => navigate(`/campaigns/compare?ids=${[...selected].join(",")}`)}>
                  <GitCompareArrows className="size-3.5" aria-hidden /> Compare
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            )}
          </div>
          {q.error != null && <div className="px-3"><ErrorBox error={q.error} /></div>}
          {!q.data ? (
            q.error ? null : <div className="space-y-2 px-3 pb-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
          ) : q.data.items.length === 0 ? <EmptyData /> : (
            <MetricsTable rows={q.data.items} nameHeader="Campaign" linkBase="/campaigns"
              selection={{ ids: selected, max: MAX_COMPARE, onToggle: toggle }}
              sort={{
                by: sort.by, order: sort.order,
                // Clicking the same header flips the direction; a new column starts descending (names ascending).
                onChange: (by) => { setSort((s) => s.by === by ? { by, order: s.order === "asc" ? "desc" : "asc" } : { by, order: by === "name" ? "asc" : "desc" }); setPage(1); },
              }} />
          )}
          {q.data && pages > 1 && (
            <div className="flex items-center justify-between px-3 text-sm text-ink-2">
              <span>Page {page} of {pages}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
