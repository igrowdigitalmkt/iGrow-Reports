"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { ArrowUpRight, Monitor, Moon, Settings2, ShieldCheck, Sun } from "lucide-react";
import type { WorkspaceIdentity } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";
import { AiSettingsPanel } from "@/modules/ai/ai-settings-panel";
import { logoutAction } from "@/modules/auth/actions";
import { ProfilePanel } from "@/modules/profile/profile-panel";
import { PdfLayoutPanel } from "@/modules/reports/pdf-layout-panel";

const subscribeToHydration = () => () => {};

export type SettingsSectionKey = "perfil" | "espaco" | "aparencia" | "pdf" | "ia";
export const SETTINGS_SECTIONS: { key: SettingsSectionKey; label: string; adminOnly?: boolean }[] = [
  { key: "perfil", label: "Perfil" },
  { key: "espaco", label: "Espaço de trabalho" },
  { key: "aparencia", label: "Aparência" },
  { key: "pdf", label: "Layout do PDF", adminOnly: true },
  { key: "ia", label: "Inteligência artificial", adminOnly: true },
];

type PanelProps = { identity: WorkspaceIdentity; demo: boolean; agencyId?: string; canAdmin: boolean };

function WorkspacePanel({ identity, demo }: { identity: WorkspaceIdentity; demo: boolean }) {
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Espaço de trabalho e acesso</h2><p>{demo ? "Contexto demonstrativo" : "Contexto autenticado da sua sessão"}</p></div><ShieldCheck size={18} className="muted" /></div>
    <dl className="settings-fields"><div><dt>Espaço de trabalho</dt><dd>{identity.agencyName}</dd></div><div><dt>Usuário</dt><dd>{identity.userName}</dd></div><div><dt>Perfil</dt><dd>{identity.roleLabel}</dd></div><div><dt>Fuso horário</dt><dd className="font-mono text-sm">{identity.timezone}</dd></div></dl>
    {demo ? <Link className="button button-secondary" href="/entrar">Entrar no meu espaço<ArrowUpRight size={15} /></Link> : <div className="flex gap-3 flex-wrap"><Link className="button button-secondary" href="/selecionar-espaco">Trocar espaço de trabalho</Link><form action={logoutAction}><button className="button button-secondary" type="submit">Sair da conta</button></form></div>}
  </section>;
}

function AppearancePanel() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return <section className="panel settings-panel">
    <div className="panel-heading"><div><h2>Aparência</h2><p>Escolha como a plataforma aparece para você</p></div><Settings2 size={18} className="muted" /></div>
    <div className="theme-options">{[{ key: "dark", label: "Escuro", Icon: Moon }, { key: "light", label: "Claro", Icon: Sun }, { key: "system", label: "Sistema", Icon: Monitor }].map(({ key, label, Icon }) => <button key={key} className={cn("theme-option", hydrated && theme === key && "selected")} onClick={() => setTheme(key)} aria-pressed={hydrated && theme === key}><Icon size={24} /><span>{label}</span></button>)}</div>
    <p className="muted text-xs mt-5">Sua preferência fica salva neste navegador.</p>
  </section>;
}

/** Um painel de configurações (usado no popup de Configurações). */
export function SettingsPanel({ section, identity, demo, agencyId, canAdmin }: PanelProps & { section: SettingsSectionKey }) {
  if (section === "perfil") return <ProfilePanel name={identity.userName} email={identity.email ?? (demo ? "silvio@igrow.com.br" : "")} avatarUrl={identity.avatarUrl ?? null} demo={demo} />;
  if (section === "espaco") return <WorkspacePanel identity={identity} demo={demo} />;
  if (section === "aparencia") return <AppearancePanel />;
  if (!demo && agencyId && canAdmin) return section === "pdf" ? <PdfLayoutPanel agencyId={agencyId} /> : <AiSettingsPanel agencyId={agencyId} />;
  return null;
}

/** Todos os painéis lado a lado (página /configuracoes, que continua existindo para links antigos). */
export function SettingsGrid(props: PanelProps) {
  return <div className="settings-grid">
    {SETTINGS_SECTIONS.filter(section => !section.adminOnly).map(section => <SettingsPanel key={section.key} section={section.key} {...props} />)}
    {SETTINGS_SECTIONS.filter(section => section.adminOnly).map(section => <SettingsPanel key={section.key} section={section.key} {...props} />)}
  </div>;
}
