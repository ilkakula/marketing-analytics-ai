import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import type { MetricKey, Point } from "@/lib/types";

export function Sparkline({ points, metric }: { points: Point[]; metric: MetricKey }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) return <div className="h-10" />;
  return (
    <div className="h-10" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Hidden y domain follows the data (does not start at zero), otherwise sparklines are flat lines. */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area type="monotone" dataKey={metric} stroke="var(--series-1)" strokeWidth={1.75} fill={`url(#${id})`} dot={false} isAnimationActive={false} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
