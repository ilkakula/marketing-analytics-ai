import { cn } from "@/lib/cn";

/** A compact pill switcher (single choice); buttons expose aria-pressed for assistive tech. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={cn("cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-all",
            value === o.value ? "bg-surface-3 text-ink shadow-sm ring-1 ring-line-strong" : "text-ink-2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
