import { z } from "zod";
import { loadCampaignsData } from "@/modules/campaigns/load";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import type { LiveMetaCampaign } from "@/modules/client-portal/client-overview";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Campanhas da Meta com o estado de veiculação REAL, pela mesma leitura (e o mesmo cache curto) da tela de Campanhas. Só leitura.
 * A Visão geral busca isto depois de abrir, para não atrasar a página.
 */
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const parsed = z.uuid().safeParse((await params).clientId);
  if (!parsed.success) return Response.json({ error: "Cliente inválido." }, { status: 400, headers });
  await requireClientDashboardAccess(parsed.data);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return Response.json({ error: "Período inválido." }, { status: 400, headers });
  const contas = url.searchParams.get("contas") ?? undefined;
  const data = await loadCampaignsData(parsed.data, { periodo: "custom", from, to, ...(contas ? { contas } : {}) });
  if (data.state !== "ready") return Response.json({ error: data.message ?? "Campanhas indisponíveis agora.", campaigns: [] }, { headers });
  const campaigns: LiveMetaCampaign[] = data.rows.filter(row => row.level === "campaign").map(row => ({
    id: row.id, accountId: row.accountId, name: row.name, accountName: row.accountName, currency: row.currency, values: row.values,
    state: { label: row.state.label, tone: row.state.tone, group: row.state.group, restriction: row.state.restrictions[0]?.label ?? null },
  }));
  return Response.json({ campaigns, live: data.live.state }, { headers });
}
