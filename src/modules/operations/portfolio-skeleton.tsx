import type { CSSProperties } from "react";

const block = (width: CSSProperties["width"], height: number, extra: CSSProperties = {}) => <span className="sk" style={{ display: "block", width, height, ...extra }} />;

export function PortfolioSkeleton() {
  return <div role="status" aria-busy="true" aria-label="Carregando a carteira">
    <div className="stats-grid">{Array.from({ length: 4 }, (_, index) => <div className="panel sk-card" key={index}>{block("55%", 14)}{block("65%", 28)}{block("40%", 12)}</div>)}</div>
    <div className="portfolio-grid">
      <div className="panel" style={{ overflow: "hidden" }}><div style={{ padding: "16px 18px" }}>{block(140, 18)}</div>{Array.from({ length: 4 }, (_, index) => <div className="sk-row" key={index}>{block(30, 30, { borderRadius: 8, flexShrink: 0 })}<div style={{ flex: 1 }}>{block("35%", 14)}{block("20%", 12, { marginTop: 6 })}</div>{block("12%", 14)}{block("10%", 14)}</div>)}</div>
      <div className="panel" style={{ overflow: "hidden" }}><div style={{ padding: "16px 18px" }}>{block(160, 18)}</div>{Array.from({ length: 3 }, (_, index) => <div className="sk-row" key={index}>{block(28, 28, { borderRadius: 8, flexShrink: 0 })}<div style={{ flex: 1 }}>{block("60%", 14)}{block("85%", 12, { marginTop: 6 })}</div></div>)}</div>
    </div>
  </div>;
}
