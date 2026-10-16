"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { cancelSubscriptionAction } from "./actions";

type Props = { paidUntil: string | null; periodActive: boolean };

/** Cancelamento com confirmação explícita. Só o proprietário vê isto; o servidor e o banco conferem de novo. Não reembolsa nem apaga dados. */
export function CancelSubscription({ paidUntil, periodActive }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const sent = useRef(false); // trava síncrona contra clique duplo antes de o estado atualizar

  function confirmCancel() {
    if (sent.current || pending) return;
    sent.current = true;
    startTransition(async () => {
      try {
        const response = await cancelSubscriptionAction();
        setResult({ ok: response.status !== "error", message: response.message });
        if (response.status === "error") sent.current = false;
        else router.refresh();
      } catch {
        sent.current = false;
        setResult({ ok: false, message: "Não foi possível falar com o servidor. Nada foi alterado; confira sua conexão e tente de novo." });
      }
    });
  }

  if (result?.ok) return <section className="panel billing-panel" aria-live="polite"><p className="billing-message billing-info" role="status">{result.message}</p></section>;
  return <section className="panel billing-panel" aria-labelledby="billing-cancel">
    <h2 id="billing-cancel">Cancelar assinatura</h2>
    {!open ? <>
      <p className="billing-muted">Você pode cancelar quando quiser. Ao cancelar, a renovação automática é interrompida.</p>
      <button type="button" className="button button-secondary billing-danger" onClick={() => { setOpen(true); setResult(null); }}>Cancelar assinatura</button>
    </> : <div className="billing-confirm" role="alertdialog" aria-labelledby="billing-cancel-title" aria-describedby="billing-cancel-body">
      <h3 id="billing-cancel-title">Confirmar o cancelamento?</h3>
      <ul id="billing-cancel-body" className="billing-lines">
        <li>{periodActive ? <>Seu acesso continua disponível até <strong>{paidUntil ?? "o fim do período pago"}</strong>.</> : <>O período pago já terminou: os recursos pagos continuam bloqueados e podem ser contratados de novo quando você quiser.</>}</li>
        <li>Não haverá renovação nem novas cobranças.</li>
        <li>Seus clientes, relatórios, integrações e configurações são preservados.</li>
        <li>Não há reembolso automático do período já pago.</li>
      </ul>
      {result && !result.ok && <p className="billing-message billing-bad" role="alert">{result.message}</p>}
      <div className="billing-actions">
        <button type="button" className="button button-secondary billing-danger" disabled={pending} onClick={confirmCancel}>
          {pending ? <><LoaderCircle size={14} className="billing-spin" aria-hidden="true" /> Cancelando…</> : "Sim, cancelar assinatura"}
        </button>
        <button type="button" className="button button-ghost" disabled={pending} onClick={() => { setOpen(false); setResult(null); }}>Manter assinatura</button>
      </div>
    </div>}
  </section>;
}
