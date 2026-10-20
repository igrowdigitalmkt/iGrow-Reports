"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { runManualOperationAction } from "../manual/actions";
import { OperationsServicesContext } from "../manual/entity-operations";
import { BATCH_MAX, planBatch, runBatch, summarizeBatch, type BatchOp, type BatchOutcome, type BatchRunner } from "./batch";
import { entityKey } from "./selection";
import type { CampaignRow } from "../tree";
import "../manual/operations.css";
import "./navigation.css";

const LEVEL = { campaign: "campanha", adset: "conjunto" } as const;
const OUTCOME_LABEL: Record<BatchOutcome["status"], string> = { verified: "Confirmada na Meta", needs_verification: "Aguardando verificação", failed: "Não realizada", skipped: "Não enviada" };

/**
 * Revisão e execução de pausa/retomada EM LOTE. Mostra o que será enviado e o que é incompatível ANTES; só envia depois da confirmação
 * explícita e entidade por entidade (cada uma com idempotência, revalidação no servidor e registro próprios). O resultado é por entidade.
 */
export function BatchDialog({ op, rows, clientId, runner: runnerProp, onClose, onDone }: {
  op: BatchOp; rows: CampaignRow[]; clientId: string; runner?: BatchRunner; onClose: () => void; onDone: (verified: number) => void;
}) {
  const services = useContext(OperationsServicesContext);
  const runner = runnerProp ?? (services.runner as BatchRunner | undefined) ?? (runManualOperationAction as BatchRunner);
  const element = useRef<HTMLDialogElement>(null);
  const [understood, setUnderstood] = useState(false);
  const [running, setRunning] = useState(false);
  const [outcomes, setOutcomes] = useState<BatchOutcome[] | null>(null);
  useEffect(() => { const node = element.current; if (node && !node.open) node.showModal(); }, []);
  const plan = planBatch(op, rows, entityKey);
  const level = rows.length && rows.every(row => row.level === rows[0]!.level) ? LEVEL[rows[0]!.level as "campaign" | "adset"] ?? "entidade" : "entidade";
  const verb = op === "pause" ? "Pausar" : "Retomar";
  const names = new Map(rows.map(row => [entityKey(row), row.name]));
  const canRun = !running && !outcomes && plan.compatible.length > 0 && !plan.tooMany && (op === "pause" || understood);

  const run = async () => {
    setRunning(true); setOutcomes([]);
    const results = await runBatch({ clientId, op, items: plan.compatible, runner, newRequestId: () => crypto.randomUUID(), onProgress: outcome => setOutcomes(current => [...(current ?? []), outcome]) });
    setRunning(false);
    onDone(summarizeBatch(results).verified);
  };
  const summary = outcomes ? summarizeBatch(outcomes) : null;

  return <dialog ref={element} className="ops-dialog batch-dialog" aria-labelledby="batch-title" onCancel={event => { event.preventDefault(); if (!running) onClose(); }} onClose={() => { if (!running) onClose(); }}>
    <div className="batch-body">
      <h3 id="batch-title">{verb} {plan.items.length} {plan.items.length === 1 ? level : `${level === "campanha" ? "campanhas" : level === "conjunto" ? "conjuntos" : "entidades"}`}</h3>
      <dl className="ops-summary">
        <div><dt>Contas envolvidas</dt><dd>{plan.accounts.join(", ")}</dd></div>
        <div><dt>Serão enviadas</dt><dd>{plan.compatible.length}</dd></div>
        <div><dt>Incompatíveis</dt><dd>{plan.incompatible.length}</dd></div>
      </dl>
      {plan.tooMany && <p className="ops-note is-warn" role="alert"><TriangleAlert size={14} /> Um lote aceita até {BATCH_MAX} entidades. Reduza a seleção.</p>}
      {!outcomes && <>
        {plan.incompatible.length > 0 && <details className="batch-list" open><summary>Não serão enviadas ({plan.incompatible.length})</summary>
          <ul>{plan.incompatible.map(item => <li key={item.key}><strong>{item.row.name}</strong><small>{item.reason}</small></li>)}</ul></details>}
        {plan.compatible.length > 0 && <details className="batch-list"><summary>Serão enviadas ({plan.compatible.length})</summary>
          <ul>{plan.compatible.map(item => <li key={item.key}><strong>{item.row.name}</strong><small>{item.row.accountName}</small></li>)}</ul></details>}
        <p className="ops-note is-info">{op === "pause"
          ? "A veiculação de cada entidade será interrompida e o gasto deve parar. Cada uma é uma operação separada: pode haver sucesso parcial, e nada é repetido automaticamente se o resultado for desconhecido."
          : "A veiculação de cada entidade será retomada e o gasto voltará a ocorrer. Cada uma é uma operação separada, revalidada no servidor (incluindo o orçamento confirmado); pode haver sucesso parcial."}</p>
        {op === "resume" && <label className="ops-check"><input type="checkbox" checked={understood} disabled={running} onChange={event => setUnderstood(event.target.checked)} /><span>Entendo que esta alteração muda o gasto e será feita agora nas contas reais da Meta.</span></label>}
      </>}
      {outcomes && <>
        <p className="ops-note" role="status" aria-live="polite">{running ? <><Loader2 size={14} className="ops-spin" /> Enviando e aguardando a confirmação da Meta, uma entidade por vez… ({outcomes.length} de {plan.compatible.length})</>
          : summary && `Concluído: ${summary.verified} confirmada(s), ${summary.uncertain} aguardando verificação, ${summary.failed} não realizada(s), ${summary.skipped} não enviada(s).`}</p>
        <ul className="batch-results">{outcomes.map(outcome => <li key={outcome.key} className={`is-${outcome.status}`}>
          {outcome.status === "verified" ? <CheckCircle2 size={14} /> : outcome.status === "failed" ? <XCircle size={14} /> : <TriangleAlert size={14} />}
          <div><strong>{names.get(outcome.key) ?? "Entidade"}</strong><small>{OUTCOME_LABEL[outcome.status]}. {outcome.message}</small></div></li>)}</ul>
        {!running && summary && summary.uncertain > 0 && <p className="ops-note is-warn" role="alert">Há alteração aguardando verificação: a conta fica bloqueada para novas alterações até a conciliação. Consulte o histórico da entidade; não reenvie.</p>}
      </>}
      <div className="ops-dialog-actions">
        <button type="button" className="ops-btn" onClick={onClose} disabled={running}>{outcomes ? "Fechar" : "Cancelar"}</button>
        {!outcomes && <button type="button" className={`ops-btn is-primary${op === "pause" ? "" : " is-financial"}`} disabled={!canRun} onClick={() => void run()}>{verb} {plan.compatible.length} {plan.compatible.length === 1 ? "entidade" : "entidades"}</button>}
      </div>
    </div>
  </dialog>;
}
