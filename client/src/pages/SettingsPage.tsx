import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBox } from "@/components/ui/states";
import { useWorkspace } from "@/hooks/queries";
import { api } from "@/lib/api";
import type { Workspace } from "@/lib/types";
import { PageHeader } from "./PageHeader";

const COMMON = ["USD", "EUR", "GBP", "CHF", "RSD", "CAD", "AUD", "JPY", "PLN", "SEK"];

function useCurrencies() {
  return useMemo(() => {
    const names = new Intl.DisplayNames(["en"], { type: "currency" });
    const all = Intl.supportedValuesOf("currency");
    const label = (c: string) => `${c} · ${names.of(c) ?? c}`;
    return { common: COMMON.filter((c) => all.includes(c)).map((c) => ({ c, label: label(c) })), rest: all.filter((c) => !COMMON.includes(c)).map((c) => ({ c, label: label(c) })) };
  }, []);
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: ws } = useWorkspace();
  const currencies = useCurrencies();
  // `null` means "not edited yet": the form follows the server value until the user types.
  const [name, setName] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: { name: string; currency: string; targetRoas: number }) => api<Workspace>("/api/workspaces/current", { method: "PATCH", json: body }),
    onSuccess: (updated) => {
      qc.setQueryData(["workspace"], updated); // every amount in the app re-formats with the new currency
      for (const k of ["summary"]) qc.invalidateQueries({ queryKey: [k] });
      setName(null); setCurrency(null); setTarget(null); setSaved(true);
    },
  });

  const nameValue = name ?? ws?.name ?? "";
  const currencyValue = currency ?? ws?.currency ?? "USD";
  const targetValue = target ?? String(ws?.targetRoas ?? 1);
  const targetNumber = Number(targetValue);
  const targetValid = Number.isFinite(targetNumber) && targetNumber >= 1 && targetNumber <= 100;
  const dirty = !!ws && targetValid && (nameValue.trim() !== ws.name || currencyValue !== ws.currency || targetNumber !== ws.targetRoas);
  const submit = (e: FormEvent) => { e.preventDefault(); setSaved(false); save.mutate({ name: nameValue.trim(), currency: currencyValue, targetRoas: targetNumber }); };

  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace preferences" showRange={false} />
      <Card className="animate-fade-up max-w-xl">
        <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Workspace name">
              <Input required maxLength={120} value={nameValue} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
            </Field>
            <Field label="Currency">
              <Select value={currencyValue} onChange={(e) => { setCurrency(e.target.value); setSaved(false); }}>
                <optgroup label="Common">{currencies.common.map(({ c, label }) => <option key={c} value={c}>{label}</option>)}</optgroup>
                <optgroup label="All currencies">{currencies.rest.map(({ c, label }) => <option key={c} value={c}>{label}</option>)}</optgroup>
              </Select>
            </Field>
            <p className="text-xs text-ink-2">The currency only changes how amounts are displayed. Imported values are not converted.</p>
            <Field label="Target ROAS">
              <Input type="number" inputMode="decimal" min={1} max={100} step="0.1" value={targetValue}
                aria-invalid={!targetValid} onChange={(e) => { setTarget(e.target.value); setSaved(false); }} />
            </Field>
            <p className="text-xs text-ink-2">
              The return you are aiming for. Campaigns below 1 are always reported as losing money; campaigns that are profitable but
              below this target are reported as below target. 1 means break-even only.
              {!targetValid && <span role="alert" className="ml-1 text-bad">Enter a number from 1 to 100.</span>}
            </p>
            {save.error != null && <ErrorBox error={save.error} />}
            <div className="flex items-center gap-3">
              <Button type="submit" variant="brand" disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
              {saved && <span role="status" className="flex items-center gap-1.5 text-sm text-good"><Check className="size-4" aria-hidden /> Saved</span>}
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
