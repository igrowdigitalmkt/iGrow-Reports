"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { addGoogleCreditAction, removeGoogleCreditAction } from "@/modules/google-ads/credit-actions";
import type { CreditEntry } from "@/modules/google-ads/credit-balance";

const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
const day = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
/** "1.234,56", "1234.56" ou "R$ 40" → número; vazio ou inválido → null. */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(cleaned) ? cleaned.replace(/\./g, "") : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Informar os créditos (depósitos) de uma conta do Google Ads: a API do Google não informa o crédito de pagamentos manuais, então a
 * Groow guarda o que foi depositado e estima o saldo descontando o gasto lido do Google. Os créditos informados ficam listados e
 * podem ser removidos (o histórico é preservado).
 */
export function GoogleCreditDialog({ open, onOpenChange, clientId, accountId, accountName, currency, entries, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void; clientId: string; accountId: string; accountName: string; currency: string; entries: CreditEntry[]; onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const todayIso = new Date().toISOString().slice(0, 10);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = parseMoneyInput(String(data.get("amount") ?? ""));
    if (amount == null || amount <= 0) { setError("Informe o valor depositado."); return; }
    setError("");
    startTransition(async () => {
      const result = await addGoogleCreditAction({ clientId, accountId, amount, depositedOn: String(data.get("date") ?? ""), note: String(data.get("note") ?? "") || undefined });
      if (result.ok) { form.reset(); onChanged(); } else setError(result.message);
    });
  };
  const remove = (creditId: string) => {
    setError("");
    startTransition(async () => {
      const result = await removeGoogleCreditAction({ clientId, creditId });
      if (result.ok) onChanged(); else setError(result.message);
    });
  };

  return <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }} title={`Crédito informado · ${accountName}`}
    description="O Google Ads não informa o crédito de pagamentos manuais (Pix, boleto, pré-pago). Informe os depósitos e a Groow estima o saldo descontando o gasto lido do Google.">
    <form onSubmit={submit} className="credit-form">
      <label>Valor depositado ({currency})<input name="amount" className="input mt-2" inputMode="decimal" placeholder="40,00" required disabled={pending} /></label>
      <label>Data em que o crédito passou a valer<input name="date" type="date" className="input mt-2" defaultValue={todayIso} max={todayIso} required disabled={pending} /></label>
      <label>Observação <span className="muted">(opcional)</span><input name="note" className="input mt-2" maxLength={200} placeholder="Ex.: Pix de 13/10" disabled={pending} /></label>
      {error && <p role="alert" className="credit-error">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Adicionar crédito"}</Button>
    </form>
    <section className="credit-list" aria-label="Créditos informados">
      <strong>Créditos informados</strong>
      {entries.length ? <ul>{entries.map(entry => <li key={entry.id}>
        <span><b>{money(entry.amount, entry.currency)}</b> · {day(entry.depositedOn)}{entry.note ? ` · ${entry.note}` : ""}</span>
        <button type="button" className="icon-button" onClick={() => remove(entry.id)} disabled={pending} aria-label={`Remover o crédito de ${money(entry.amount, entry.currency)}`}><Trash2 size={15} /></button>
      </li>)}</ul> : <p className="muted">Nenhum crédito informado ainda.</p>}
      <p className="muted credit-note">Estimativa: créditos informados − gasto do Google Ads desde o primeiro depósito. Não inclui impostos, ajustes nem créditos que o Google aplique sozinho.</p>
    </section>
  </Dialog>;
}
