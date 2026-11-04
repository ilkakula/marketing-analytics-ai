import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Preset = "7d" | "30d" | "90d" | "all" | "custom";
export interface Range { preset: Preset; from?: string; to?: string }

const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function presetRange(preset: Exclude<Preset, "custom">): Range {
  if (preset === "all") return { preset };
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { preset, from: iso(from), to: iso(to) };
}

const Ctx = createContext<{ range: Range; setRange: (r: Range) => void } | null>(null);

// The selected period is shared by every screen (overview, campaigns, details).
export function RangeProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<Range>(() => presetRange("30d"));
  const value = useMemo(() => ({ range, setRange }), [range]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useRange() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRange van RangeProvider-a");
  return c;
}
