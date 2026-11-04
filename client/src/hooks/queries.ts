import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { makeFmt } from "@/lib/format";
import { useRange } from "@/lib/dateRange";
import type { CampaignDetail, CampaignList, ImportHistoryItem, Point, Summary, Workspace } from "@/lib/types";
import { useMemo } from "react";

export function useWorkspace() {
  return useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspaces/current"), staleTime: Infinity });
}
export function useFmt() {
  const { data } = useWorkspace();
  return useMemo(() => makeFmt(data?.currency), [data?.currency]);
}

export function useSummary() {
  const { range } = useRange();
  const compare = range.from && range.to ? "true" : undefined;
  return useQuery({
    queryKey: ["summary", range.from, range.to],
    queryFn: () => api<Summary>("/api/analytics/summary", { query: { from: range.from, to: range.to, compare } }),
    placeholderData: keepPreviousData,
  });
}
export function useTimeseries() {
  const { range } = useRange();
  return useQuery({
    queryKey: ["timeseries", range.from, range.to],
    queryFn: () => api<{ points: Point[] }>("/api/analytics/timeseries", { query: { from: range.from, to: range.to } }),
    placeholderData: keepPreviousData,
  });
}
export interface CampaignParams { search: string; sortBy: string; order: "asc" | "desc"; page: number; pageSize: number }
export function useCampaigns(p: CampaignParams) {
  const { range } = useRange();
  return useQuery({
    queryKey: ["campaigns", range.from, range.to, p],
    queryFn: () => api<CampaignList>("/api/campaigns", { query: { from: range.from, to: range.to, ...p } }),
    placeholderData: keepPreviousData,
  });
}
export function useCampaign(id: string) {
  const { range } = useRange();
  return useQuery({
    queryKey: ["campaign", id, range.from, range.to],
    queryFn: () => api<CampaignDetail>(`/api/campaigns/${id}`, { query: { from: range.from, to: range.to } }),
    placeholderData: keepPreviousData,
  });
}

export function useImports() {
  return useQuery({ queryKey: ["imports"], queryFn: () => api<{ items: ImportHistoryItem[] }>("/api/imports") });
}
