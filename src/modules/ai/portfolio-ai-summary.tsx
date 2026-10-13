"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { generatePortfolioSummary } from "./portfolio-actions";

export function PortfolioAiSummary({ agencyId, period }: { agencyId: string; period: "7d" | "30d" | "90d" }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function run() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await generatePortfolioSummary({ agencyId, period });
        if (result.ok) setText(result.text); else { setText(""); setMessage(result.message); }
      } catch { setText(""); setMessage("Não foi possível gerar o resumo agora. Tente novamente."); }
    });
  }

  return <section className="panel" style={{ padding: "16px 20px", marginBottom: 16 }}>
    <div className="panel-heading" style={{ paddingBottom: 8 }}>
      <div><h2>Resumo do dia</h2><p>A IA aponta os clientes que pedem atenção, com base nos dados confirmados do período selecionado.</p></div>
      <button type="button" className="button button-secondary button-sm" disabled={pending} onClick={run}><Sparkles size={14} />{pending ? "Gerando…" : text ? "Gerar de novo" : "Gerar resumo com IA"}</button>
    </div>
    {text && <>
      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, margin: "4px 0 8px" }}>{text}</p>
      <p className="muted text-xs">Gerado por IA a partir dos números confirmados. Confira no painel de cada cliente antes de agir.</p>
    </>}
    {message && <p role="alert" className="text-sm" style={{ margin: "4px 0 0" }}>{message}</p>}
  </section>;
}
