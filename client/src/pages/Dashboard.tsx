import { Link } from "react-router-dom";
import { AiInsightsPanel } from "@/components/AiInsightsPanel";
import { AskPanel } from "@/components/AskPanel";
import { ExportButton } from "@/components/ExportButton";
import { KpiGrid, KpiSkeleton } from "@/components/KpiGrid";
import { TimeseriesChart } from "@/components/TimeseriesChart";
import { MetricsTable } from "@/components/CampaignTable";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyData, ErrorBox } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampaigns, useSummary, useTimeseries } from "@/hooks/queries";
import { useRange } from "@/lib/dateRange";
import { longDate } from "@/lib/format";
import { PageHeader } from "./PageHeader";

export function Dashboard() {
  const { range } = useRange();
  const summary = useSummary();
  const series = useTimeseries();
  const top = useCampaigns({ search: "", sortBy: "spend", order: "desc", page: 1, pageSize: 5 });

  const error = summary.error ?? series.error ?? top.error;
  const s = summary.data;
  const empty = s && s.totals.impressions === 0 && s.totals.spend === 0;
  const prev = s?.previous?.period;

  return (
    <>
      <PageHeader title="Overview" subtitle={prev ? `Compared with ${longDate(prev.from)} – ${longDate(prev.to)}` : "All time"}
        actions={<ExportButton query={{ from: range.from, to: range.to, sortBy: "spend", order: "desc" }} />} />
      {error != null && <ErrorBox error={error} />}
      {!s || !series.data ? (
        error ? null : (
          <>
            <KpiSkeleton />
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-80 w-full rounded-2xl" />
          </>
        )
      ) : empty ? (
        <Card><EmptyData /></Card>
      ) : (
        <>
          <KpiGrid totals={s.totals} change={s.change} points={series.data.points} />
          <AiInsightsPanel />
          <AskPanel />
          <TimeseriesChart points={series.data.points} />
          <Card className="animate-fade-up">
            <CardHeader>
              <CardTitle>Campaigns with the highest spend</CardTitle>
              <Link to="/campaigns" className="text-sm font-medium text-accent-text hover:underline">All campaigns →</Link>
            </CardHeader>
            <CardBody className="px-2 pt-2">
              {top.data && <MetricsTable rows={top.data.items} nameHeader="Campaign" linkBase="/campaigns" />}
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
