"use client";

import { ChevronDown } from "lucide-react";

/** Seta de recolher/expandir ao lado do nome da plataforma. Aberta por padrão (quem usa controla o estado). */
export function SectionToggle({ collapsed, label, onToggle }: { collapsed: boolean; label: string; onToggle: () => void }) {
  return <button type="button" className="section-toggle" aria-expanded={!collapsed} aria-label={`${collapsed ? "Expandir" : "Recolher"} ${label}`} title={collapsed ? "Expandir seção" : "Recolher seção"} onClick={onToggle}>
    <ChevronDown size={16} className={collapsed ? "is-collapsed" : undefined} aria-hidden="true" /></button>;
}
