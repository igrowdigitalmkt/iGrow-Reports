"use client";

import { useMemo, useState, useTransition } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { startCheckoutAction } from "./actions";
import { billingDataSchema } from "./billing-data";
import { cycleDescriptions, cycleLabels, describeEntitlement, formatBRL, priceOf, yearlySavings, type Cycle, type Offer } from "./offers";

type Props = { offers: Offer[]; requestKey: string; needsBillingData: boolean; canContract: boolean };
type Field = "name" | "cpfCnpj" | "email" | "phone" | "postalCode" | "address" | "addressNumber" | "province" | "complement";
const FIELDS: { key: Field; label: string; autoComplete: string; inputMode?: "numeric" | "tel" | "email"; wide?: boolean; optional?: boolean; placeholder?: string }[] = [
  { key: "name", label: "Nome ou razão social", autoComplete: "organization", wide: true },
  { key: "cpfCnpj", label: "CPF ou CNPJ", autoComplete: "off", inputMode: "numeric", placeholder: "Somente números" },
  { key: "email", label: "E-mail para a cobrança", autoComplete: "email", inputMode: "email" },
  { key: "phone", label: "Telefone com DDD", autoComplete: "tel", inputMode: "tel" },
  { key: "postalCode", label: "CEP", autoComplete: "postal-code", inputMode: "numeric", placeholder: "00000-000" },
  { key: "address", label: "Endereço", autoComplete: "address-line1", wide: true },
  { key: "addressNumber", label: "Número", autoComplete: "address-line2" },
  { key: "province", label: "Bairro", autoComplete: "address-level3" },
  { key: "complement", label: "Complemento", autoComplete: "off", optional: true },
];

export function CheckoutForm({ offers, requestKey, needsBillingData, canContract }: Props) {
  const initial = offers.find((offer) => offer.recommended) ?? offers[0];
  const [versionId, setVersionId] = useState(initial?.plan_version_id ?? "");
  const [cycle, setCycle] = useState<Cycle>(initial && priceOf(initial, "monthly") ? "monthly" : "yearly");
  const [values, setValues] = useState<Record<Field, string>>({ name: "", cpfCnpj: "", email: "", phone: "", postalCode: "", address: "", addressNumber: "", province: "", complement: "" });
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const offer = useMemo(() => offers.find((item) => item.plan_version_id === versionId) ?? initial, [offers, versionId, initial]);
  if (!offer) return null;
  const price = priceOf(offer, cycle);
  const cycles = (["monthly", "yearly"] as Cycle[]).filter((item) => priceOf(offer, item));

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canContract) return;
    setError(null); setNotice(null);
    if (needsBillingData) {
      const parsed = billingDataSchema.safeParse(values);
      if (!parsed.success) { setError({ message: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "") || null }); return; }
    }
    startTransition(async () => {
      try {
        // Só plano, ciclo, chave de reenvio e dados de cobrança saem daqui. O valor cobrado é recalculado no servidor.
        const result = await startCheckoutAction({ planVersionId: offer!.plan_version_id, cycle, requestKey, billing: needsBillingData ? values : undefined });
        if (result.status === "redirect") { window.location.assign(result.url); return; }
        if (result.status === "pending") setNotice(result.message);
        else if (result.status === "invalid_data") setError({ message: result.message, field: result.field });
        else if (result.status === "needs_billing_data") setError({ message: result.message, field: null });
        else setError({ message: result.message, field: null });
      } catch {
        setError({ message: "Não foi possível iniciar a contratação agora. Nada foi cobrado. Tente novamente em instantes.", field: null });
      }
    });
  }

  return <form className="billing-form" onSubmit={submit} noValidate aria-busy={pending}>
    <fieldset disabled={pending} className="billing-fieldset">
      <legend className="billing-legend">1. Plano</legend>
      <div className="billing-plans" role="radiogroup" aria-label="Plano">
        {offers.map((item) => {
          const selected = item.plan_version_id === offer.plan_version_id;
          const lines = item.entitlements.map(describeEntitlement).filter((line): line is string => Boolean(line));
          return <label key={item.plan_version_id} className="billing-plan" data-selected={selected}>
            <input type="radio" name="plan" value={item.plan_version_id} checked={selected} onChange={() => { setVersionId(item.plan_version_id); if (!priceOf(item, cycle)) setCycle(priceOf(item, "monthly") ? "monthly" : "yearly"); }} />
            <span className="billing-plan-head"><strong>{item.name}</strong>{item.recommended && <span className="badge neutral">Recomendado</span>}</span>
            {item.description && <span className="billing-muted">{item.description}</span>}
            {lines.length > 0 && <ul className="billing-lines">{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
          </label>;
        })}
      </div>
    </fieldset>

    <fieldset disabled={pending} className="billing-fieldset">
      <legend className="billing-legend">2. Período</legend>
      <div className="billing-cycles" role="radiogroup" aria-label="Período de cobrança">
        {cycles.map((item) => {
          const cents = priceOf(offer, item)!;
          const saving = item === "yearly" ? yearlySavings(offer) : null;
          return <label key={item} className="billing-cycle" data-selected={cycle === item}>
            <input type="radio" name="cycle" value={item} checked={cycle === item} onChange={() => setCycle(item)} />
            <span><strong>{cycleLabels[item]}</strong> · {formatBRL(cents)}{item === "monthly" ? " por mês" : " por ano"}</span>
            <span className="billing-muted">{cycleDescriptions[item]}{saving ? ` · economia de ${formatBRL(saving)} no ano` : ""}</span>
          </label>;
        })}
      </div>
    </fieldset>

    {needsBillingData && <fieldset disabled={pending} className="billing-fieldset">
      <legend className="billing-legend">3. Dados de cobrança</legend>
      <p className="billing-muted">Exigidos pelo Asaas para emitir a cobrança. Não guardamos estes dados no iGrow Reports e o cartão é digitado só na página segura do Asaas.</p>
      <div className="billing-grid">
        {FIELDS.map((field) => <label key={field.key} className={field.wide ? "billing-field billing-wide" : "billing-field"}>
          <span>{field.label}{field.optional ? " (opcional)" : ""}</span>
          <input className="input" name={field.key} value={values[field.key]} autoComplete={field.autoComplete} inputMode={field.inputMode} placeholder={field.placeholder}
            aria-invalid={error?.field === field.key} aria-describedby={error?.field === field.key ? "billing-error" : undefined}
            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
        </label>)}
      </div>
    </fieldset>}

    <div className="billing-summary" aria-live="polite">
      <div><span className="billing-muted">Total desta contratação</span><strong className="billing-total">{price ? formatBRL(price) : "—"}</strong>
        <span className="billing-muted">{cycle === "monthly" ? "por mês, renovado automaticamente" : "por ano, em uma cobrança única, renovada automaticamente"}</span></div>
      <button type="submit" className="button button-primary" disabled={pending || !canContract || !price}>
        {pending ? <><LoaderCircle size={16} className="billing-spin" aria-hidden="true" />Preparando o pagamento…</> : <><LockKeyhole size={16} aria-hidden="true" />Ir para o pagamento seguro</>}
      </button>
    </div>
    <p className="billing-muted">Você será levado ao ambiente seguro do Asaas para pagar com cartão de crédito. O plano só é liberado depois que o pagamento for confirmado. O cancelamento vale no fim do período já pago.</p>
    {error && <p id="billing-error" role="alert" className="billing-message billing-bad">{error.message}</p>}
    {notice && <p role="status" className="billing-message billing-info">{notice}</p>}
  </form>;
}
