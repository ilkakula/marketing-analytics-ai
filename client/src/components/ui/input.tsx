import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const base =
  "h-9 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink placeholder:text-muted transition-colors hover:border-ink/30 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/40";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(base, className)} {...p} />
);
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn(base, "cursor-pointer pr-8", className)} {...p} />
);
export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-medium text-ink-2">{label}</span>
    {children}
  </label>
);
