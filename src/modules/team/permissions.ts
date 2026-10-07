import type { AgencyRole } from "@/types/database";

export const TEAM_MODULES = [
  { key: "visao_geral", label: "Visão geral", hint: "Resumo de todos os clientes" },
  { key: "clientes", label: "Clientes", hint: "Cadastro, destinatários e painel de cada cliente" },
  { key: "relatorios", label: "Relatórios", hint: "Entregas, templates e PDFs" },
  { key: "agendamentos", label: "Agendamentos", hint: "Mensagens automáticas e envio imediato" },
  { key: "integracoes", label: "Integrações", hint: "Meta Ads e WhatsApp" },
  { key: "whatsapp", label: "WhatsApp", hint: "Caixa de entrada das conversas dos números conectados" },
] as const;
export type TeamModule = typeof TEAM_MODULES[number]["key"];

export const ROLE_HINTS: Record<AgencyRole, string> = {
  owner: "Acesso total, inclusive equipe e proprietários.",
  admin: "Acesso total e gestão da equipe, exceto proprietários.",
  editor: "Trabalha nos clientes, relatórios e envios, sem gerir a equipe.",
  viewer: "Apenas consulta, sem alterar nada.",
};

// Workspace section → module that controls it. Configurações is personal and always open.
const SECTION_MODULE: Record<string, TeamModule> = {
  "": "visao_geral", clientes: "clientes", "relatorios-visao": "relatorios", entregas: "relatorios", templates: "relatorios", relatorios: "relatorios",
  agendamentos: "agendamentos", integracoes: "integracoes", whatsapp: "whatsapp",
};

/** Owners and administrators see everything; null modules means no restriction. */
export function canOpenSection(role: AgencyRole, modules: string[] | null, section: string) {
  if (role === "owner" || role === "admin" || !modules) return true;
  const area = SECTION_MODULE[section];
  return !area || modules.includes(area);
}
