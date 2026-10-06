"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { useRouteSkeleton } from "./navigation-progress";

const block = (width: CSSProperties["width"], height: number, extra: CSSProperties = {}) => <span className="sk" style={{ display: "block", width, height, ...extra }} />;

function Heading({ action = true }: { action?: boolean }) {
  return <div className="page-heading"><div>{block(200, 28)}{block(300, 16, { marginTop: 10 })}</div>{action && block(140, 36, { borderRadius: 8 })}</div>;
}
const Kpis = () => <div className="stats-grid">{Array.from({ length: 4 }, (_, index) => <div className="panel sk-card" key={index}>{block("55%", 14)}{block("65%", 28)}{block("40%", 12)}</div>)}</div>;
const Rows = ({ count }: { count: number }) => <>{Array.from({ length: count }, (_, index) => <div className="sk-row" key={index}>{block(30, 30, { borderRadius: 8, flexShrink: 0 })}<div style={{ flex: 1 }}>{block("32%", 14)}{block("18%", 12, { marginTop: 6 })}</div>{block("12%", 14)}{block("9%", 14)}</div>)}</>;
const Table = ({ rows }: { rows: number }) => <div className="panel" style={{ overflow: "hidden" }}><div style={{ padding: "16px 18px" }}>{block(160, 18)}</div><Rows count={rows} /></div>;

// Route-level loading state with the shape of the destination section.
export function RouteSkeleton({ base }: { base: string }) {
  useRouteSkeleton();
  const section = usePathname().replace(base, "").replace(/^\//, "").split("/")[0];
  return <div aria-busy="true" aria-label="Carregando" role="status">
    {section === "" && <><Heading /><Kpis /><div className="overview-grid"><div className="panel" style={{ padding: 18 }}>{block(180, 18)}{block("100%", 220, { marginTop: 18, borderRadius: 8 })}</div><div className="panel"><Rows count={4} /></div></div></>}
    {(section === "clientes" || section === "relatorios") && <><Heading /><div className="section-toolbar">{block(280, 34, { borderRadius: 8 })}</div><Table rows={6} /></>}
    {section === "integracoes" && <><Heading action={false} /><Table rows={3} /></>}
    {section === "configuracoes" && <><Heading action={false} /><div className="settings-grid">{[0, 1].map(index => <div className="panel sk-card" key={index}>{block(180, 18)}{block("100%", 14, { marginTop: 12 })}{block("100%", 14)}{block("70%", 14)}</div>)}</div></>}
    {["templates", "agendamentos", "entregas"].includes(section) && <><Heading action={false} /><div className="panel feature-preview">{block(44, 44, { borderRadius: 12 })}{block(200, 16, { marginTop: 8 })}{block(300, 14)}</div></>}
  </div>;
}
