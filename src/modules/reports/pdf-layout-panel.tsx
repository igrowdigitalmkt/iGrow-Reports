"use client";

import { useEffect, useState, useTransition } from "react";
import { FileText } from "lucide-react";
import { getPdfLayoutSetting, savePdfLayoutSetting } from "./layout-actions";

const OPTIONS = [
  { key: "classic", title: "Clássico", text: "O layout atual: todas as tabelas, com campanhas, conjuntos e anúncios que tiveram investimento." },
  { key: "modern", title: "Novo", text: "Resumo com todos os resultados, gráficos, análise, campanhas, público e saldo. Letras maiores para ler no celular, em A4 para imprimir." },
] as const;

export function PdfLayoutPanel({ agencyId }: { agencyId: string }) {
  const [layout, setLayout] = useState<"classic" | "modern" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getPdfLayoutSetting({ agencyId }).then(result => {
      if (!live) return;
      if ("error" in result) setError(result.error); else setLayout(result.layout);
    }).catch(() => { if (live) setError("Não foi possível carregar o layout do PDF."); });
    return () => { live = false; };
  }, [agencyId]);

  function choose(next: "classic" | "modern") {
    if (next === layout) return;
    setError(""); setNotice("");
    startTransition(async () => {
      try {
        const result = await savePdfLayoutSetting({ agencyId, layout: next });
        if ("error" in result) { setError(result.error); return; }
        setLayout(result.layout);
        setNotice(result.layout === "modern" ? "Layout novo ativado. Vale para os próximos PDFs, inclusive os envios agendados." : "Layout clássico ativado.");
      } catch { setError("Não foi possível concluir. Confira sua conexão e tente novamente."); }
    });
  }

  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Layout do PDF</h2><p>Vale para os PDFs verticais em A4, baixados, enviados ou agendados</p></div><FileText size={18} className="muted" /></div>
    {!layout && !error && <p className="muted text-sm">Carregando…</p>}
    {layout && <div role="radiogroup" aria-label="Layout do PDF" style={{ display: "grid", gap: 10 }}>
      {OPTIONS.map(option => <label key={option.key} className="flex gap-3 text-sm" style={{ alignItems: "flex-start", padding: 12, border: "1px solid var(--border)", borderRadius: 10, opacity: pending ? .7 : 1 }}>
        <input type="radio" name="pdf-layout" checked={layout === option.key} disabled={pending} onChange={() => choose(option.key)} />
        <span><strong>{option.title}</strong><br /><span className="muted">{option.text}</span></span>
      </label>)}
    </div>}
    {error && <p role="alert" className="mt-4 text-rose-400 text-sm">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}
  </section>;
}
