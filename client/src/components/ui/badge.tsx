import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5", {
  variants: {
    tone: {
      neutral: "bg-surface-3 text-ink-2",
      accent: "bg-accent-soft text-accent-text",
      good: "bg-good-soft text-good",
      bad: "bg-bad-soft text-bad",
      warn: "bg-warn-soft text-warn",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export const Badge = ({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ tone }), className)} {...p} />
);
