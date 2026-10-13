"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveAutomationRunAction, discardAutomationRunAction } from "./actions";
import type { AutomationRunItem } from "./types";

type Row = { run: AutomationRunItem; name: string; client: string; recipients: number };

// Textos escritos pela IA que esperam a revisão do responsável. Nada é enviado antes do "Aprovar e enviar".
export function PendingApprovals({ rows, canEdit, demo }: { rows: Row[]; canEdit: boolean; demo: boolean }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!rows.length) return null;

  async function act(runId: string, kind: "approve" | "discard", text: string) {
    setBusy(runId); setErrors(current => ({ ...current, [runId]: "" }));
    try {
      if (demo) throw new Error("Na demonstração nenhuma mensagem é enviada.");
      const result = kind === "approve" ? await approveAutomationRunAction({ runId, text }) : await discardAutomationRunAction({ runId });
      if ("error" in result) throw new Error(result.error);
      router.refresh();
    } catch (error) {
      setErrors(current => ({ ...current, [runId]: error instanceof Error ? error.message : "Não foi possível concluir." }));
    } finally { setBusy(null); }
  }

  return <section className="panel pending-approvals" aria-label="Aprovações pendentes">
    <div className="panel-heading"><div><h2>Aprovações pendentes</h2><p>A IA escreveu a análise. Revise e aprove: só então a mensagem é enviada.</p></div><Sparkles size={18} className="muted" /></div>
    <ul style={{ display: "grid", gap: 14, listStyle: "none", padding: 0, margin: 0 }}>{rows.map(({ run, name, client, recipients }) => {
      const text = drafts[run.id] ?? run.aiText ?? "";
      const working = busy === run.id;
      return <li key={run.id} style={{ display: "grid", gap: 8 }}>
        <strong>{client} · {name}</strong>
        <small className="muted">Período {(run.dateFrom ?? "").split("-").reverse().join("/")} a {(run.dateTo ?? "").split("-").reverse().join("/")} · vai para {recipients} {recipients === 1 ? "destino" : "destinos"}</small>
        <label className="muted text-sm" htmlFor={`ai-${run.id}`}>Análise da IA (você pode editar)</label>
        <textarea id={`ai-${run.id}`} value={text} rows={5} maxLength={1500} disabled={!canEdit || working}
          onChange={event => setDrafts(current => ({ ...current, [run.id]: event.target.value }))} style={{ width: "100%" }} />
        {run.messageText && <details><summary className="muted text-sm">Ver a mensagem completa como saiu na prévia</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{run.messageText}</pre></details>}
        {errors[run.id] && <p role="alert" className="meta-feedback error">{errors[run.id]}</p>}
        {canEdit && <div className="template-save-actions">
          <Button type="button" variant="secondary" disabled={working} onClick={() => act(run.id, "discard", text)}><Trash2 size={15} />Descartar</Button>
          <Button type="button" disabled={working || !text.trim()} onClick={() => act(run.id, "approve", text)}>{working ? <><Loader2 size={15} className="spin" />Enviando…</> : <><Check size={15} />Aprovar e enviar</>}</Button>
        </div>}
      </li>;
    })}</ul>
  </section>;
}
