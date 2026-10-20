"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import { ArrowLeft, ChartNoAxesCombined, FileText, Home, Layers3, Megaphone, type LucideIcon } from "lucide-react";
import { activeClientSection, clientSectionPath, ROUTED_SECTIONS, type ClientSection } from "./client-sections";

const ITEMS: { section: ClientSection; label: string; icon: LucideIcon }[] = [
  { section: "summary", label: "Visão geral", icon: Home },
  { section: "overview", label: "Dashboard", icon: ChartNoAxesCombined },
  { section: "campaigns", label: "Campanhas", icon: Megaphone },
  { section: "metrics", label: "Todas as métricas", icon: Layers3 },
  { section: "reports", label: "Relatórios", icon: FileText },
];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "CL";

/**
 * Menu do cliente: segunda barra, ao lado da barra principal recolhida. A troca entre as secoes analiticas muda so o endereco
 * (history.pushState, integrado ao roteador): o painel de dados continua montado e preserva selecao e rascunhos. Campanhas tem pagina
 * propria: entrar nela ou sair dela usa a navegacao normal do Next.js (o conteudo do servidor e trocado, o menu continua montado).
 * A demonstracao oculta Campanhas (`hideCampaigns`): a gestao operacional depende de contas reais da Meta.
 */
export function ClientMenu({ clientName, demo = false, hideCampaigns = false }: { clientName: string; demo?: boolean; hideCampaigns?: boolean }) {
  const pathname = usePathname();
  const parsed = activeClientSection(pathname);
  const current = parsed?.section ?? "summary";
  const base = parsed?.base ?? pathname.replace(/\/[^/]+$/, "");
  const clientsHref = demo ? "/demo/clientes" : "/clientes";

  function open(event: MouseEvent<HTMLAnchorElement>, section: ClientSection) {
    // Clique com modificador abre em nova aba normalmente; o clique simples entre secoes analiticas nao recarrega a pagina.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || !parsed) return;
    // Fronteira com uma secao de pagina propria (entrar ou sair): deixa o Link navegar pelo roteador do Next.
    if (ROUTED_SECTIONS.includes(section) || ROUTED_SECTIONS.includes(current)) return;
    event.preventDefault();
    window.history.pushState(null, "", `${clientSectionPath(parsed.base, section)}${window.location.search}`);
  }

  return <nav className="client-menu" aria-label={`Menu de ${clientName}`}>
    <div className="client-menu-head">
      <span className="client-menu-avatar" aria-hidden="true">{initialsOf(clientName)}</span>
      <span className="client-menu-identity"><strong title={clientName}>{clientName}</strong><Link href={clientsHref}><ArrowLeft size={12} />Todos os clientes</Link></span>
    </div>
    <ul className="client-menu-list">
      {ITEMS.filter(item => !(hideCampaigns && item.section === "campaigns")).map(({ section, label, icon: Icon }) => <li key={section}>
        {/* A busca (periodo, contas) so acompanha entre secoes analiticas: a gestao de Campanhas tem os proprios filtros. */}
        <Link href={clientSectionPath(base, section)} prefetch={false} onClick={event => open(event, section)} aria-current={current === section ? "page" : undefined} className="client-menu-item">
          <Icon size={20} strokeWidth={1.92} /><span>{label}</span>
        </Link>
      </li>)}
    </ul>
  </nav>;
}
