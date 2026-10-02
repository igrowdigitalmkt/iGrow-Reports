import type { ClientItem } from "@/modules/clients/schema";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import type { ReportsAdminSnapshot } from "@/modules/reports/types";

export function onboardingSteps(client: ClientItem | undefined, meta: MetaAdminSnapshot | undefined, reports: ReportsAdminSnapshot | undefined, analyzedClientIds: string[] = []) {
  const accounts = new Set(meta?.accounts.filter(account => !account.archivedAt).map(account => account.id));
  const linked = meta?.links.filter(link => link.active && link.clientId === client?.id && accounts.has(link.adAccountId)) ?? [];
  const updated = !!client && analyzedClientIds.includes(client.id);
  const generated = reports?.versions.some(version => version.clientId === client?.id) ?? false;
  return [
    { title: "Seu espaço", description: "Confira o nome que identifica sua operação.", href: "/dashboard/configuracoes", complete: true },
    { title: "Seu cliente", description: "Cadastre um cliente para organizar suas contas e relatórios.", href: "/dashboard/clientes", complete: !!client },
    { title: "Conectar contas", description: "Conecte a Meta e vincule as contas deste cliente.", href: `/dashboard/integracoes${client ? `?client=${client.id}` : ""}`, complete: linked.length > 0 },
    { title: "Primeira análise", description: "Abra a Visão geral e atualize os dados do período.", href: client ? `/cliente/${client.id}` : "/dashboard/clientes", complete: updated },
    { title: "Primeiro relatório", description: "Na Visão geral, gere um PDF vertical ou horizontal.", href: client ? `/cliente/${client.id}?inicio=relatorio` : "/dashboard/clientes", complete: generated },
  ];
}
