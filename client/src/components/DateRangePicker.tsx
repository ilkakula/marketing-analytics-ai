import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { presetRange, useRange, type Preset } from "@/lib/dateRange";

const OPTIONS: Array<{ value: Preset; label: string }> = [
  { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "90d", label: "90D" },
  { value: "all", label: "All" }, { value: "custom", label: "Custom" },
];

export function DateRangePicker() {
  const { range, setRange } = useRange();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarRange className="hidden size-4 text-muted sm:block" aria-hidden />
      <Segmented<Preset> label="Period" value={range.preset} options={OPTIONS}
        onChange={(p) => setRange(p === "custom" ? { preset: "custom", from: range.from, to: range.to } : presetRange(p))} />
      {range.preset === "custom" && (
        <>
          <Input type="date" className="w-36" aria-label="From" value={range.from ?? ""} max={range.to}
            onChange={(e) => setRange({ ...range, from: e.target.value || undefined })} />
          <span className="text-muted">–</span>
          <Input type="date" className="w-36" aria-label="To" value={range.to ?? ""} min={range.from}
            onChange={(e) => setRange({ ...range, to: e.target.value || undefined })} />
        </>
      )}
    </div>
  );
}
