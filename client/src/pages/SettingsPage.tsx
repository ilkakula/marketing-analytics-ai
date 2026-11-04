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
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (body: { name: string; currency: string }) => api<Workspace>("/api/workspaces/current", { method: "PATCH", json: body }),
    onSuccess: (updated) => {
      qc.setQueryData(["workspace"], updated); // every amount in the app re-formats with the new currency
      setName(null); setCurrency(null); setSaved(true);
    },
  });

  const nameValue = name ?? ws?.name ?? "";
  const currencyValue = currency ?? ws?.currency ?? "USD";
  const dirty = !!ws && (nameValue.trim() !== ws.name || currencyValue !== ws.currency);
  const submit = (e: FormEvent) => { e.preventDefault(); setSaved(false); save.mutate({ name: nameValue.trim(), currency: currencyValue }); };

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
