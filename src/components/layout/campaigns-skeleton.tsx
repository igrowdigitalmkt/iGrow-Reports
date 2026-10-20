"use client";

import type { CSSProperties } from "react";
import { useRouteSkeleton } from "./navigation-progress";

const block = (width: CSSProperties["width"], height: number, extra: CSSProperties = {}) => <span className="sk" style={{ display: "block", width, height, ...extra }} />;

// Loading state com o formato da gestão de Campanhas: título, filtros e a tabela. Serve à lista e às telas de detalhes.
export function CampaignsSkeleton() {
  useRouteSkeleton();
  return <div className="sk-stack" role="status" aria-busy="true" aria-label="Carregando campanhas">
    <div>{block(180, 28)}{block("min(520px, 100%)", 14, { marginTop: 10 })}</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{[150, 280, 170, 260].map(width => block(width, 36, { borderRadius: 8, maxWidth: "100%" }))}</div>
    <div className="panel" style={{ padding: 18 }}>
      {block(220, 16)}
      {Array.from({ length: 6 }, (_, index) => <div key={index} style={{ display: "flex", gap: 16, marginTop: 18 }}>{block("38%", 18)}{block(90, 18)}{block(110, 18)}{block(110, 18)}</div>)}
    </div>
  </div>;
}
