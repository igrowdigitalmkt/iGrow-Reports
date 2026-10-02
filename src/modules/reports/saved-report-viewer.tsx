"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import type { DashboardPdfInput } from "./pdf-download";

export function SavedReportViewer({ document }: { document: DashboardPdfInput }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false; let objectUrl = "";
    import("./pdf-download").then(({ buildDashboardPdf }) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(buildDashboardPdf(document).output("blob")); setUrl(objectUrl);
    }).catch(() => { if (!disposed) setError("Não foi possível preparar a visualização deste relatório."); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document]);
  return <section className="client-panel saved-report-viewer">
    <div className="saved-report-viewer-toolbar"><div><FileText size={17} /><span>{document.orientation === "horizontal" ? "Apresentação horizontal" : "Documento vertical A4"}</span></div><button className="button button-primary button-sm" disabled={!url} onClick={() => import("./pdf-download").then(({ downloadDashboardPdf }) => downloadDashboardPdf(document))}><Download size={14} />Baixar PDF</button></div>
    <p className="client-data-note">Conteúdo preservado no momento da geração. Atualizações do painel não alteram este relatório.</p>
    {error ? <p role="alert">{error}</p> : url ? <iframe title="Visualização completa do relatório" src={url} className="saved-report-frame" /> : <p role="status">Preparando visualização…</p>}
  </section>;
}
