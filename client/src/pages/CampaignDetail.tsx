import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { KpiGrid, KpiSkeleton } from "@/components/KpiGrid";
import { TimeseriesChart } from "@/components/TimeseriesChart";
import { MetricsTable } from "@/components/CampaignTable";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBox } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { useCampaign } from "@/hooks/queries";
import { PageHeader } from "./PageHeader";

const Back = () => (
  <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Campaigns</Link>
);

export function CampaignDetail() {
  const { id = "" } = useParams();
  const { data, error } = useCampaign(id);

  if (error instanceof ApiError && error.status === 404) {
    return <Card><CardBody className="py-12 text-center text-sm text-ink-2">Campaign not found. <Link className="font-medium text-accent-text hover:underline" to="/campaigns">Back to the list</Link></CardBody></Card>;
  }
  const adSetName = new Map(data?.adSets.map((a) => [a.id, a.name]));
  return (
    <>
      <Back />
      <PageHeader title={data?.name ?? "Campaign"} />
      {error != null && <ErrorBox error={error} />}
      {!data ? (error ? null : <KpiSkeleton />) : (
        <>
          <KpiGrid totals={data.totals} points={data.timeseries} />
          <TimeseriesChart points={data.timeseries} />
          <Card className="animate-fade-up">
            <CardHeader><CardTitle>Ad sets</CardTitle></CardHeader>
            <CardBody className="px-2 pt-2"><MetricsTable rows={data.adSets} nameHeader="Ad set" /></CardBody>
          </Card>
          <Card className="animate-fade-up">
            <CardHeader>
              <CardTitle>Ads (top {Math.min(data.ads.length, 15)} by spend)</CardTitle>
              {data.ads.length > 15 && <span className="text-xs text-ink-2">{data.ads.length} ads in total</span>}
            </CardHeader>
            <CardBody className="px-2 pt-2">
              <MetricsTable nameHeader="Ad" rows={data.ads.slice(0, 15).map((a) => ({ ...a, name: `${a.name} · ${adSetName.get(a.adSetId ?? "") ?? ""}` }))} />
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
