import type { ReactNode } from "react";
import { DateRangePicker } from "@/components/DateRangePicker";

export function PageHeader({ title, subtitle, actions, showRange = true }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; showRange?: boolean;
}) {
  return (
    <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">{actions}{showRange && <DateRangePicker />}</div>
    </div>
  );
}
