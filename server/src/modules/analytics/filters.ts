import { z } from "zod";

export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((s) => {
    // Zod runs refine even when the regex fails, and toISOString() throws a RangeError on an invalid date.
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Date does not exist");

export const filterSchema = z
  .object({
    from: dateParam.optional(),
    to: dateParam.optional(),
    // ?campaignIds=uuid1,uuid2
    campaignIds: z
      .string()
      .transform((s) => s.split(",").filter(Boolean))
      .pipe(z.array(z.uuid()).max(100))
      .optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "'from' cannot be after 'to'", path: ["from"] });

export interface Filters {
  workspaceId: string;
  from?: string;
  to?: string;
  campaignIds?: string[];
}

const DAY = 86_400_000;
const parse = (s: string) => new Date(`${s}T00:00:00Z`).getTime();
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The previous period of the same length, immediately before the selected one. */
export function previousPeriod(from: string, to: string) {
  const days = Math.round((parse(to) - parse(from)) / DAY) + 1;
  const prevTo = parse(from) - DAY;
  return { from: fmt(prevTo - (days - 1) * DAY), to: fmt(prevTo) };
}
