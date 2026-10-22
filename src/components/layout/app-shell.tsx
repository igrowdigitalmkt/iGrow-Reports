"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type FocusEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { ArrowUpRight, Bell, CalendarClock, Moon, Sun, SunMoon, ChevronRight, ChevronsUpDown, UsersRound, FileChartColumn, FlaskConical, LayoutDashboard, Menu, PanelLeft, Plug, Search, Settings2, Users, X } from "lucide-react";
import { useTheme } from "next-themes";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { AiCreditsMeter } from "./ai-credits-meter";
import { Brand } from "./brand";
import { SettingsDialog } from "./settings-dialog";
import { UserMenu } from "./user-menu";
import type { AiCreditsView } from "@/modules/ai/credits";
import { NavigationProgress } from "./navigation-progress";
import { SIDEBAR_COOKIE, SIDEBAR_COOKIE_MAX_AGE } from "./sidebar-state";
import { Dialog } from "@/components/ui/dialog";
import { isClientRoute } from "@/modules/client-portal/client-sections";
import { cn } from "@/lib/utils";

/** iconSize deve ser multiplo de 4: em telas com escala de 125% (comum no Windows) so assim o icone fecha em pixel inteiro e fica nitido. */
type NavItem = { key: string; label: string; icon: ComponentType<LucideProps>; planned?: boolean; iconSize?: number };

const NAV_ICON_SIZE = 20;
/** Traco de ~1,6 px na tela, qualquer que seja o tamanho do icone (a grade dos icones e 24). */
const navStrokeWidth = (size: number) => +(1.6 * 24 / size).toFixed(2);

export const navigationGroups: { title: string; items: NavItem[] }[] = [
  { title: "Operação", items: [
    { key: "", label: "Visão geral", icon: LayoutDashboard },
    { key: "clientes", label: "Clientes", icon: Users },
    { key: "relatorios", label: "Relatórios", icon: FileChartColumn },
    { key: "agendamentos", label: "Agendamentos", icon: CalendarClock },
  ] },
  { title: "Conta", items: [
    { key: "integracoes", label: "Integrações", icon: Plug },
    { key: "equipe", label: "Equipe", icon: UsersRound },
  ] },
  { title: "Comunicação", items: [
    { key: "whatsapp", label: "WhatsApp", icon: WhatsAppIcon, iconSize: 24 },
  ] },
];
// Configurações saiu do menu lateral (abre pelo avatar), mas a página continua existindo e precisa de nome no breadcrumb.
export const navigation: NavItem[] = [...navigationGroups.flatMap(group => group.items), { key: "configuracoes", label: "Configurações", icon: Settings2 }];
// Entregas, Templates and PDFs are tabs inside Relatórios: their names appear in the breadcrumb.
const REPORT_TAB_LABELS: Record<string, string> = { entregas: "Entregas", templates: "Templates", pdfs: "PDFs salvos" };

export interface WorkspaceIdentity { agencyName: string; userName: string; roleLabel: string; timezone: string; avatarUrl?: string | null; email?: string; agencyId?: string; canAdmin?: boolean; }
const SUPPORT_URL = "https://wa.me/5586995560428?text=" + encodeURIComponent("Olá! Preciso de ajuda com o Groow Ads.");

const SearchContext = createContext<{ search: string; setSearch: (value: string) => void }>({ search: "", setSearch: () => {} });
export const useWorkspaceSearch = () => useContext(SearchContext);

const MOBILE_QUERY = "(max-width: 900px)";
const subscribeMobile = (listener: () => void) => { const query = window.matchMedia(MOBILE_QUERY); query.addEventListener("change", listener); return () => query.removeEventListener("change", listener); };
const useIsMobile = () => useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false);
const subscribeToHydration = () => () => {};
const initialsOf = (value: string) => value.split(/[ @._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();

export function AppShell({ demo, identity, initialCollapsed = false, clientCount, whatsappUnread, workspaceCount = 1, hiddenKeys = [], aiCredits, children }: { demo: boolean; identity: WorkspaceIdentity; initialCollapsed?: boolean; clientCount?: number; whatsappUnread?: number; workspaceCount?: number; hiddenKeys?: string[]; aiCredits?: AiCreditsView | null; children: ReactNode }) {
  const base = demo ? "/demo" : "";
  const pathname = usePathname();
  const segments = pathname.replace(base, "").split("/").filter(Boolean);
  const activeKey = segments[0] ?? "";
  const reportTab = activeKey === "relatorios" ? REPORT_TAB_LABELS[segments[1] ?? ""] : undefined;
  const current = navigation.find(item => item.key === activeKey)?.label ?? "Visão geral";
  const [savedCollapsed, setCollapsed] = useState(initialCollapsed);
  // Dentro de um cliente a barra principal recolhe sozinha (o menu do cliente aparece ao lado). Expandir a mao abre por cima
  // ("peek"), sem empurrar o conteudo e sem alterar a preferencia salva, que volta ao sair do cliente.
  const clientMode = isClientRoute(pathname);
  const [peek, setPeek] = useState(false);
  const collapsed = clientMode ? !peek : savedCollapsed;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string; top: number; left: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const mobile = useIsMobile();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const dark = resolvedTheme !== "light";
  const themeLabel = !hydrated ? "Mudar tema" : dark ? "Mudar para o tema claro" : "Mudar para o tema escuro";
  const toggleLabel = mobile ? (drawerOpen ? "Fechar menu" : "Abrir menu") : (collapsed ? "Expandir menu" : "Recolher menu");
  const href = (key: string) => key ? `${base}/${key}` : base || "/";

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) { setDrawerOpen(open => !open); return; }
    setTooltip(null);
    if (clientMode) { setPeek(open => !open); return; }
    setCollapsed(previous => {
      const next = !previous;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
      return next;
    });
  }, [clientMode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "b") { event.preventDefault(); toggleSidebar(); }
      if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); searchInput.current?.focus(); }
      if (event.key === "Escape") { setDrawerOpen(false); setPeek(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the drawer closes after any route change
  useEffect(() => { setDrawerOpen(false); setPeek(false); setTooltip(null); }, [pathname]);

  // WhatsApp unread conversations, refreshed in the background (and shown in the tab title like WhatsApp Web).
  const [liveUnread, setLiveUnread] = useState<number | null>(null);
  const whatsappVisible = !demo && !hiddenKeys.includes("whatsapp");
  useEffect(() => {
    if (!whatsappVisible) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetch("/api/whatsapp/inbox/unread", { cache: "no-store" }).then(response => response.ok ? response.json() : null)
        .then((body: { count?: number } | null) => { if (!cancelled && typeof body?.count === "number") setLiveUnread(body.count); }).catch(() => undefined);
    };
    const timer = setInterval(load, 15000);
    document.addEventListener("visibilitychange", load);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [whatsappVisible]);
  const unread = liveUnread ?? whatsappUnread ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = unread > 0 ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
  }, [unread, pathname]);

  function showTooltip(event: ReactMouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const target = (event.target as Element).closest<HTMLElement>("[data-tip]");
    if (!collapsed || !target || window.matchMedia(MOBILE_QUERY).matches) { setTooltip(null); return; }
    const rect = target.getBoundingClientRect();
    setTooltip({ text: target.dataset.tip ?? "", top: rect.top + rect.height / 2, left: rect.right + 10 });
  }

  return <SearchContext.Provider value={{ search, setSearch }}>
    <div className={cn("app-shell", collapsed && "is-collapsed", clientMode && "is-client-mode", clientMode && peek && "is-peek", drawerOpen && "is-drawer-open")}>
      <a href="#main-content" className="skip-link">Pular para o conteúdo</a>
      <Suspense fallback={null}><NavigationProgress /></Suspense>
      <aside className="sidebar" aria-label="Menu lateral" onMouseOver={showTooltip} onMouseLeave={() => setTooltip(null)} onFocus={showTooltip} onBlur={() => setTooltip(null)}>
        <div className="sidebar-head">
          <Link href={href("")} aria-label="Groow Ads, visão geral" className="brand-link"><Brand /></Link>
        </div>
        {/* Switching only makes sense for people in more than one workspace (e.g. a freelancer for several agencies). */}
        {workspaceCount > 1 ? <Link className="agency-switch" href={demo ? "/demo/configuracoes" : "/selecionar-espaco"} data-tip={`${identity.agencyName} · trocar espaço`} aria-label={`Espaço de trabalho: ${identity.agencyName}. Trocar espaço`}>
          <span className="agency-avatar">{initialsOf(identity.agencyName).slice(0, 2) || "iG"}</span>
          <strong className="collapse-hide">{identity.agencyName}</strong>
          <ChevronsUpDown size={14} className="collapse-hide" />
        </Link> : <div className="agency-switch is-static" data-tip={identity.agencyName} aria-label={`Espaço de trabalho: ${identity.agencyName}`}>
          <span className="agency-avatar">{initialsOf(identity.agencyName).slice(0, 2) || "iG"}</span>
          <strong className="collapse-hide">{identity.agencyName}</strong>
        </div>}
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navigationGroups.map(group => <div className="nav-group" key={group.title}>
            <span className="nav-title" aria-hidden={collapsed}>{group.title}</span>
            {group.items.filter(item => !hiddenKeys.includes(item.key)).map(({ key, label, icon: Icon, planned, iconSize = NAV_ICON_SIZE }) => <Link key={key} href={href(key)} aria-current={key === activeKey ? "page" : undefined} data-tip={planned ? `${label} · Em breve` : label} aria-label={collapsed ? label : undefined} className={cn("nav-item", planned && "is-planned")}>
              <Icon size={iconSize} strokeWidth={navStrokeWidth(iconSize)} style={iconSize !== NAV_ICON_SIZE ? { marginInline: (NAV_ICON_SIZE - iconSize) / 2 } : undefined} />
              <span className="collapse-hide">{label}</span>
              {planned && <span className="nav-soon collapse-hide">Em breve</span>}
              {key === "clientes" && !!clientCount && <span className="nav-count collapse-hide">{clientCount}</span>}
              {key === "whatsapp" && unread > 0 && <span className="nav-count is-unread" aria-label={`${unread} conversas não lidas`}>{unread > 99 ? "99+" : unread}</span>}
            </Link>)}
          </div>)}
        </nav>
        <div className="sidebar-footer">
          {aiCredits && <AiCreditsMeter credits={aiCredits} />}
        </div>
      </aside>
      <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      {clientMode && peek && <div className="peek-scrim" onClick={() => setPeek(false)} aria-hidden="true" />}
      {tooltip && <span className="shell-tooltip" role="tooltip" style={{ top: tooltip.top, left: tooltip.left, transform: "translateY(-50%)" }}>{tooltip.text}</span>}

      <div className="workspace">
        <header className="topbar">
          <button type="button" className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label={toggleLabel} aria-expanded={mobile ? drawerOpen : !collapsed} title={`${toggleLabel} (Ctrl+B)`}>
            <PanelLeft size={18} className="hide-mobile" /><Menu size={18} className="show-mobile" />
          </button>
          <div className="crumbs">{reportTab
            ? <><Link href={href("relatorios")}>Relatórios</Link><ChevronRight size={14} /><strong>{reportTab}</strong></>
            : segments.length > 1
            ? <><Link href={href(activeKey)}>{current}</Link><ChevronRight size={14} /><strong>{activeKey === "clientes" ? "Painel do cliente" : "Detalhes"}</strong></>
            : <><span className="hide-mobile">{identity.agencyName}</span><ChevronRight size={14} className="hide-mobile" /><strong>{current}</strong></>}</div>
          <span className="topbar-spacer" />
          <label className="search-control" onClick={() => searchInput.current?.focus()}>
            <Search size={15} />
            <input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)} aria-label="Buscar cliente ou relatório" placeholder="Buscar cliente ou relatório" />
            {search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}><X size={14} /></button> : <kbd>Ctrl K</kbd>}
          </label>
          <button type="button" className="icon-button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={themeLabel} title={themeLabel}>{!hydrated ? <SunMoon size={17} /> : dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button type="button" className="icon-button notification-button" onClick={() => setNoticeOpen(true)} aria-label="Abrir notificações"><Bell size={17} />{demo && <span className="notification-dot" />}</button>
          <UserMenu identity={identity} demo={demo} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} />
        </header>
        {demo && <div className="demo-banner"><span><FlaskConical size={14} /><strong>Modo demonstração</strong><span>Todos os dados são fictícios. Nenhuma mensagem é enviada.</span></span><Link href="/entrar">Acessar meu espaço <ArrowUpRight size={13} /></Link></div>}
        <main id="main-content" className={cn("main-content", activeKey === "whatsapp" && "is-full")} tabIndex={-1}>{children}</main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} identity={identity} demo={demo} />
      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen} title="Notificações" description={demo ? "Exemplos fictícios de pendências." : "Avisos do seu espaço de trabalho."}>{demo ? <div className="space-y-3"><div className="notice-item"><span className="status-dot amber" /><div><strong>Um relatório aguarda aprovação</strong><p className="muted text-sm mt-1">Verde & Grão · revisão demonstrativa</p></div></div><div className="notice-item"><span className="status-dot cyan" /><div><strong>Primeiros passos da plataforma</strong><p className="muted text-sm mt-1">Conecte a Meta e cadastre seus clientes.</p></div></div><Link href={`${base}/relatorios/pdfs`} onClick={() => setNoticeOpen(false)} className="button button-secondary w-full">Ver relatórios</Link></div> : <p className="muted text-sm">Nenhum aviso no momento.</p>}</Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Central de ajuda" description="Fale com o suporte ou siga o caminho para o primeiro relatório."><a className="button button-primary w-full" href={SUPPORT_URL} target="_blank" rel="noreferrer"><WhatsAppIcon size={16} />Falar com o suporte no WhatsApp</a><ol className="onboarding-list mt-5"><li><span>1</span><div><strong>Conecte a Meta</strong><p>Em Integrações, entre com o Facebook e autorize as contas de anúncio.</p></div></li><li><span>2</span><div><strong>Cadastre os clientes</strong><p>Em Clientes, crie cada cliente e associe as contas de anúncio dele.</p></div></li><li><span>3</span><div><strong>Abra o painel</strong><p>O painel do cliente mostra os números do período e gera o relatório em PDF.</p></div></li></ol></Dialog>
    </div>
  </SearchContext.Provider>;
}
