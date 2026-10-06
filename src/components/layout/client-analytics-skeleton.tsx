"use client";

import type { CSSProperties } from "react";
import { useRouteSkeleton } from "./navigation-progress";

const block = (width: CSSProperties["width"], height: number, extra: CSSProperties = {}) => <span className="sk" style={{ display: "block", width, height, ...extra }} />;

// Loading state with the shape of the client dashboard: header, filters, indicators and charts.
export function ClientAnalyticsSkeleton() {
  useRouteSkeleton();
  return <div className="sk-stack" role="status" aria-busy="true" aria-label="Carregando painel do cliente">
    <div className="page-heading" style={{ marginBottom: 0, alignItems: "center" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>{block(40, 40, { borderRadius: 10 })}<div>{block(220, 26)}{block(160, 14, { marginTop: 8 })}</div></div>
      <div style={{ display: "flex", gap: 8 }}>{block(118, 36, { borderRadius: 8 })}{block(140, 36, { borderRadius: 8 })}</div>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>{block(400, 34, { borderRadius: 8, maxWidth: "100%" })}{block(270, 32, { borderRadius: 8, maxWidth: "100%" })}</div>
    <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 0 }}>{Array.from({ length: 3 }, (_, index) => <div className="panel sk-card" key={index} style={{ minHeight: 132 }}>{block("50%", 14)}{block("60%", 28)}{block("35%", 12)}</div>)}</div>
    <div className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 0 }}>{Array.from({ length: 6 }, (_, index) => <div className="panel sk-card" key={index}>{block("60%", 13)}{block("50%", 20)}</div>)}</div>
    <div className="overview-grid" style={{ marginBottom: 0 }}><div className="panel" style={{ padding: 18 }}>{block(200, 18)}{block("100%", 280, { marginTop: 18, borderRadius: 8 })}</div><div className="panel" style={{ padding: 18 }}>{block(160, 18)}{block(180, 180, { margin: "28px auto", borderRadius: "50%" })}{block("100%", 14)}{block("80%", 14, { marginTop: 10 })}</div></div>
  </div>;
}
