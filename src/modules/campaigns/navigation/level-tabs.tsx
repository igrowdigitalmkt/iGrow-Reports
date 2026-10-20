"use client";

import type { PlatformLevel } from "../platforms/registry";
import "./navigation.css";

/**
 * Abas de nível da plataforma. Os nomes vêm do registro (Meta: Campanhas › Conjuntos de anúncios › Anúncios; TikTok e Google: Grupos de
 * anúncios; Performance Max: Grupos de recursos › Recursos; LinkedIn: Grupos de campanhas › Campanhas › Criativos). Teclado: setas, Home e End.
 */
export function LevelTabs({ levels, active, counts, picked, onChange, label = "Níveis da gestão de campanhas", idPrefix = "level" }: {
  /** Prefixo dos ids (várias plataformas na mesma página não repetem ids). */ idPrefix?: string;
  levels: PlatformLevel[]; active: string; counts?: Record<string, number>; picked?: Record<string, number>; onChange: (key: string) => void; label?: string;
}) {
  const move = (index: number, event: React.KeyboardEvent) => {
    const next = event.key === "ArrowRight" ? (index + 1) % levels.length : event.key === "ArrowLeft" ? (index - 1 + levels.length) % levels.length : event.key === "Home" ? 0 : event.key === "End" ? levels.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onChange(levels[next]!.key);
    requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${levels[next]!.key}`)?.focus());
  };
  return <div className="level-tabs" role="tablist" aria-label={label}>
    {levels.map((level, index) => <button key={level.key} id={`${idPrefix}-tab-${level.key}`} type="button" role="tab" className="level-tab" aria-selected={active === level.key} aria-controls={`${idPrefix}-panel-${level.key}`}
      tabIndex={active === level.key ? 0 : -1} onClick={() => onChange(level.key)} onKeyDown={event => move(index, event)}>
      {level.label}
      {counts?.[level.key] !== undefined && <span className="level-count" aria-label={`${counts[level.key]} itens`}>{counts[level.key]}</span>}
      {!!picked?.[level.key] && <span className="level-picked" aria-label={`${picked[level.key]} selecionados`}>{picked[level.key]} ✓</span>}
    </button>)}
  </div>;
}
