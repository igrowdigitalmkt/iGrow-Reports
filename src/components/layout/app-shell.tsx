"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Bell, CalendarClock, ChevronDown, ChevronRight, ChevronsUpDown, CircleHelp, FileChartColumn, LayoutDashboard, LayoutTemplate, Menu, Plug, Search, Send, Settings2, Users, X, FlaskConical } from "lucide-react";
import { Brand } from "./brand";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const navigation = [
  { key: "", label: "Dashboard", icon: LayoutDashboard },
  { key: "clientes", label: "Clientes", icon: Users },
  { key: "relatorios", label: "Relatórios", icon: FileChartColumn },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "agendamentos", label: "Agendamentos", icon: CalendarClock },
  { key: "entregas", label: "Entregas", icon: Send },
  { key: "integracoes", label: "Integrações", icon: Plug },
  { key: "configuracoes", label: "Configurações", icon: Settings2 },
];

export interface WorkspaceIdentity { agencyName: string; userName: string; roleLabel: string; timezone: string; }

export function AppShell({ demo, identity, children, search, onSearch }: { demo: boolean; identity: WorkspaceIdentity; children: ReactNode; search: string; onSearch: (value: string) => void }) {
  const base = demo ? "/demo" : "/dashboard";
  const pathname = usePathname();
  const activeKey = pathname.replace(base, "").replace(/^\//, "");
  const current = navigation.find(item => item.key === activeKey)?.label ?? "Dashboard";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const initials = identity.userName.split(/[ @.]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

  const nav = <>
    <Link href={base} aria-label="iGrow Reports — dashboard" className="brand-link"><Brand /></Link>
    <Link className="agency-switch" href={demo ? "/demo/configuracoes" : "/selecionar-agencia"} onClick={() => setMobileOpen(false)}><span className="agency-avatar">iG</span><span className="min-w-0"><strong>{identity.agencyName}</strong><small>{demo ? "Espaço demonstrativo" : "Seu espaço de trabalho"}</small></span><ChevronsUpDown size={14} className="ml-auto muted shrink-0" /></Link>
    <span className="nav-label">NAVEGAÇÃO</span>
    <nav aria-label="Navegação principal">{navigation.map(({ key, label, icon: Icon }, index) => <Link key={key} href={`${base}${key ? `/${key}` : ""}`} onClick={() => setMobileOpen(false)} aria-current={key === activeKey ? "page" : undefined} className={cn("nav-item", key === activeKey && "nav-active", index === 6 && "nav-separated")}><Icon size={18} strokeWidth={1.65} /><span>{label}</span>{demo && key === "relatorios" && <span className="nav-count">2</span>}</Link>)}</nav>
    <div className="sidebar-bottom"><button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={16} /> Central de ajuda <ArrowUpRight size={13} /></button><Link className="user-profile" href={`${base}/configuracoes`} onClick={() => setMobileOpen(false)}><span className="user-avatar">{initials || "IG"}</span><span className="min-w-0"><strong>{identity.userName}</strong><small>{identity.roleLabel}</small></span><ChevronDown size={13} className="ml-auto muted" /></Link></div>
  </>;

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
    <aside className="sidebar">{nav}</aside>
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen} title="Navegação" description="Escolha uma área do seu espaço de trabalho."><div className="mobile-nav">{nav}</div></Dialog>
    <div className="workspace">
      <header className="topbar"><div className="flex items-center gap-3"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={19} /></button><div className="breadcrumb"><span>{identity.agencyName}</span><ChevronRight size={12} /><strong>{current}</strong></div></div><div className="topbar-actions"><div className="search-control"><Search size={15} /><input value={search} onChange={event => onSearch(event.target.value)} aria-label="Buscar cliente ou relatório" placeholder="Pesquisar…" />{search ? <button aria-label="Limpar busca" onClick={() => onSearch("")}><X size={13} /></button> : <kbd>Ctrl K</kbd>}</div><span className="topbar-divider" /><button className="icon-button notification-button" onClick={() => setNoticeOpen(true)} aria-label="Abrir notificações"><Bell size={17} />{demo && <span className="notification-dot" />}</button><Link href={`${base}/configuracoes`} className="topbar-avatar" aria-label="Abrir configurações do perfil">{initials || "IG"}</Link></div></header>
      {demo && <div className="demo-banner"><span><FlaskConical size={14} /><strong>Modo demonstração</strong><span className="demo-banner-detail">Todos os dados são fictícios. Nenhuma mensagem é enviada.</span></span><Link href="/entrar">Acessar meu espaço <ArrowUpRight size={13} /></Link></div>}
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>iGrow Reports <span className="muted">/</span> Clareza em cada resultado.</span><span>{demo ? "Ambiente demonstrativo" : "Fundação · v0.1.0"}<span className="footer-dot" />{identity.timezone}</span></footer>
    </div>
    <Dialog open={noticeOpen} onOpenChange={setNoticeOpen} title={demo ? "Notificações demonstrativas" : "Notificações"} description={demo ? "Exemplos fictícios de pendências operacionais." : "O acompanhamento operacional será ativado nos próximos incrementos."}>{demo ? <div className="space-y-4"><div className="notice-item"><span className="status-dot amber" /><div><strong>Um relatório aguarda aprovação</strong><p className="muted text-sm mt-1">Verde & Grão · revisão demonstrativa</p></div></div><div className="notice-item"><span className="status-dot cyan" /><div><strong>Primeiros passos da plataforma</strong><p className="muted text-sm mt-1">Meta Ads e WhatsApp serão conectados em etapas futuras.</p></div></div><Link href={`${base}/relatorios`} onClick={() => setNoticeOpen(false)} className="button button-secondary w-full">Consultar relatórios</Link></div> : <p className="muted">Ainda não há eventos operacionais para exibir.</p>}</Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Seu ponto de partida" description="A fundação da iGrow Reports está pronta para evoluir."><ol className="onboarding-list"><li><span>01</span><div><strong>Configure o Supabase</strong><p>Aplique as migrations e crie o primeiro proprietário pelo procedimento controlado.</p></div></li><li><span>02</span><div><strong>Acesse seu espaço</strong><p>Entre com sua conta e selecione um espaço de trabalho do qual você faz parte.</p></div></li><li><span>03</span><div><strong>Prepare as integrações</strong><p>Meta Ads, WhatsApp e automações estão previstas nos próximos incrementos.</p></div></li></ol><p className="muted text-xs mt-5">O passo a passo técnico está no README e em docs/BANCO.md do projeto.</p></Dialog>
  </div>;
}
