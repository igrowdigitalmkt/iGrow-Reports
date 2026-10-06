"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowUpRight, Bell, CalendarClock, ChevronRight, ChevronsUpDown, CircleHelp, FileChartColumn, FlaskConical, LayoutDashboard, LayoutTemplate, Menu, PanelLeft, Plug, Search, Send, Settings2, Users, X } from "lucide-react";
import { Brand } from "./brand";
import { NavigationProgress } from "./navigation-progress";
import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "./sidebar-state";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type NavItem = { key: string; label: string; icon: typeof Users; planned?: boolean };

export const navigationGroups: { title: string; items: NavItem[] }[] = [
  { title: "Operação", items: [
    { key: "", label: "Visão geral", icon: LayoutDashboard },
    { key: "clientes", label: "Clientes", icon: Users },
    { key: "relatorios", label: "Relatórios", icon: FileChartColumn },
  ] },
  { title: "Automação", items: [
    { key: "templates", label: "Templates", icon: LayoutTemplate, planned: true },
    { key: "agendamentos", label: "Agendamentos", icon: CalendarClock, planned: true },
    { key: "entregas", label: "Entregas", icon: Send },
  ] },
  { title: "Conta", items: [
    { key: "integracoes", label: "Integrações", icon: Plug },
    { key: "configuracoes", label: "Configurações", icon: Settings2 },
  ] },
];
export const navigation = navigationGroups.flatMap(group => group.items);

export interface WorkspaceIdentity { agencyName: string; userName: string; roleLabel: string; timezone: string; }

const SearchContext = createContext<{ search: string; setSearch: (value: string) => void }>({ search: "", setSearch: () => {} });
export const useWorkspaceSearch = () => useContext(SearchContext);

const MOBILE_QUERY = "(max-width: 900px)";
const subscribeMobile = (listener: () => void) => { const query = window.matchMedia(MOBILE_QUERY); query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); };
const useIsMobile = () => useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
const initialsOf = (value: string) => value.split(/[ @._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export function AppShell({ demo, identity, initialCollapsed = false, clientCount, children }: { demo: boolean; identity: WorkspaceIdentity; initialCollapsed?: boolean; clientCount?: number; children: ReactNode }) {
  const base = demo ? "/demo" : "/dashboard";
  const pathname = usePathname();
  const segments = pathname.replace(base, "").split("/").filter(Boolean);
  const activeKey = segments[0] ?? "";
  const current = navigation.find(item => item.key === activeKey)?.label ?? "Visão geral";
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string; top: number; left: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile();
  const toggleLabel = mobile ? (drawerOpen ? "Fechar menu" : "Abrir menu") : (collapsed ? "Expandir menu" : "Recolher menu");
  const initials = initialsOf(identity.userName) || "IG";
  const href = (key: string) => `${base}${key ? `/${key}` : ""}`;

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) { setDrawerOpen(open => !open); return; }
    setTooltip(null);
    setCollapsed(previous => {
      const next = !previous;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "b") { event.preventDefault(); toggleSidebar(); }
      if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); searchInput.current?.focus(); }
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the drawer closes after any route change
  useEffect(() => { setDrawerOpen(false); setTooltip(null); }, [pathname]);

  function showTooltip(event: ReactMouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const target = (event.target as Element).closest<HTMLElement>("[data-tip]");
    if (!collapsed || !target || window.matchMedia(MOBILE_QUERY).matches) { setTooltip(null); return; }
    const rect = target.getBoundingClientRect();
    setTooltip({ text: target.dataset.tip ?? "", top: rect.top + rect.height / 2, left: rect.right + 10 });
  }

  return <SearchContext.Provider value={{ search, setSearch }}>
    <div className={cn("app-shell", collapsed && "is-collapsed", drawerOpen && "is-drawer-open")}>
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
      <Suspense fallback={null}><NavigationProgress /></Suspense>
      <aside className="sidebar" aria-label="Menu lateral" onMouseOver={showTooltip} onMouseLeave={() => setTooltip(null)} onFocus={showTooltip} onBlur={() => setTooltip(null)}>
        <div className="sidebar-head">
          <Link href={base} aria-label="iGrow Reports, visão geral" className="brand-link"><Brand /></Link>
        </div>
        <Link className="agency-switch" href={demo ? "/demo/configuracoes" : "/selecionar-agencia"} data-tip={identity.agencyName} aria-label={`Espaço de trabalho: ${identity.agencyName}. Trocar espaço`}>
          <span className="agency-avatar">{initialsOf(identity.agencyName).slice(0, 2) || "iG"}</span>
          <strong className="collapse-hide">{identity.agencyName}</strong>
          <ChevronsUpDown size={14} className="collapse-hide" />
        </Link>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navigationGroups.map(group => <div className="nav-group" key={group.title}>
            <span className="nav-title" aria-hidden={collapsed}>{group.title}</span>
            {group.items.map(({ key, label, icon: Icon, planned }) => <Link key={key} href={href(key)} aria-current={key === activeKey ? "page" : undefined} data-tip={planned ? `${label} · Em breve` : label} aria-label={collapsed ? label : undefined} className={cn("nav-item", planned && "is-planned")}>
              <Icon size={17} strokeWidth={1.75} />
              <span className="collapse-hide">{label}</span>
              {planned && <span className="nav-soon collapse-hide">Em breve</span>}
              {key === "clientes" && !!clientCount && <span className="nav-count collapse-hide">{clientCount}</span>}
              {demo && key === "relatorios" && <span className="nav-count collapse-hide">2</span>}
            </Link>)}
          </div>)}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="nav-item" data-tip="Central de ajuda" aria-label={collapsed ? "Central de ajuda" : undefined} onClick={() => setHelpOpen(true)}><CircleHelp size={17} strokeWidth={1.75} /><span className="collapse-hide">Central de ajuda</span></button>
          <Link className="user-profile" href={href("configuracoes")} data-tip={`${identity.userName} · ${identity.roleLabel}`} aria-label={`Perfil de ${identity.userName}`}>
            <span className="user-avatar">{initials}</span>
            <span className="user-meta collapse-hide"><strong>{identity.userName}</strong><small>{identity.roleLabel}</small></span>
          </Link>
        </div>
      </aside>
      <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      {tooltip && <span className="shell-tooltip" role="tooltip" style={{ top: tooltip.top, left: tooltip.left, transform: "translateY(-50%)" }}>{tooltip.text}</span>}

      <div className="workspace">
        <header className="topbar">
          <button type="button" className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label={toggleLabel} aria-expanded={mobile ? drawerOpen : !collapsed} title={`${toggleLabel} (Ctrl+B)`}>
            <PanelLeft size={18} className="hide-mobile" /><Menu size={18} className="show-mobile" />
          </button>
          <div className="crumbs">{segments.length > 1
            ? <><Link href={href(activeKey)}>{current}</Link><ChevronRight size={14} /><strong>{activeKey === "clientes" ? "Painel do cliente" : "Detalhes"}</strong></>
            : <><span className="hide-mobile">{identity.agencyName}</span><ChevronRight size={14} className="hide-mobile" /><strong>{current}</strong></>}</div>
          <span className="topbar-spacer" />
          <label className="search-control" onClick={() => searchInput.current?.focus()}>
            <Search size={15} />
            <input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)} aria-label="Buscar cliente ou relatório" placeholder="Buscar cliente ou relatório" />
            {search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}><X size={14} /></button> : <kbd>Ctrl K</kbd>}
          </label>
          <button type="button" className="icon-button notification-button" onClick={() => setNoticeOpen(true)} aria-label="Abrir notificações"><Bell size={17} />{demo && <span className="notification-dot" />}</button>
        </header>
        {demo && <div className="demo-banner"><span><FlaskConical size={14} /><strong>Modo demonstração</strong><span>Todos os dados são fictícios. Nenhuma mensagem é enviada.</span></span><Link href="/entrar">Acessar meu espaço <ArrowUpRight size={13} /></Link></div>}
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      </div>

      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen} title="Notificações" description={demo ? "Exemplos fictícios de pendências." : "Avisos do seu espaço de trabalho."}>{demo ? <div className="space-y-3"><div className="notice-item"><span className="status-dot amber" /><div><strong>Um relatório aguarda aprovação</strong><p className="muted text-sm mt-1">Verde & Grão · revisão demonstrativa</p></div></div><div className="notice-item"><span className="status-dot cyan" /><div><strong>Primeiros passos da plataforma</strong><p className="muted text-sm mt-1">Conecte a Meta e cadastre seus clientes.</p></div></div><Link href={`${base}/relatorios`} onClick={() => setNoticeOpen(false)} className="button button-secondary w-full">Ver relatórios</Link></div> : <p className="muted text-sm">Nenhum aviso no momento.</p>}</Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Central de ajuda" description="O caminho para o primeiro relatório."><ol className="onboarding-list"><li><span>1</span><div><strong>Conecte a Meta</strong><p>Em Integrações, entre com o Facebook e autorize as contas de anúncio.</p></div></li><li><span>2</span><div><strong>Cadastre os clientes</strong><p>Em Clientes, crie cada cliente e associe as contas de anúncio dele.</p></div></li><li><span>3</span><div><strong>Abra o painel</strong><p>O painel do cliente mostra os números do período e gera o relatório em PDF.</p></div></li></ol></Dialog>
    </div>
  </SearchContext.Provider>;
}
