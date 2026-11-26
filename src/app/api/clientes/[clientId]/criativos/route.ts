import { z } from "zod";
import { billingBlockOf } from "@/modules/billing/guard";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getClientCampaignCreatives } from "@/modules/meta/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Criativos (imagem e link do post) das campanhas do cliente: /api/clientes/ID/criativos?campanhas=ID1,ID2. Só leitura, mesma autorização do painel.
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const parsed = z.uuid().safeParse((await params).clientId);
  if (!parsed.success) return Response.json({ error: "Cliente inválido." }, { status: 400, headers });
  const campaignIds = (new URL(request.url).searchParams.get("campanhas") ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (!campaignIds.length || campaignIds.some(id => !/^\d+$/.test(id))) return Response.json({ error: "Informe os IDs das campanhas." }, { status: 400, headers });
  const { access } = await requireClientDashboardAccess(parsed.data);
  try {
    return Response.json({ campaigns: await getClientCampaignCreatives({ agencyId: access.agencyId, clientId: parsed.data, campaignIds }) }, { headers });
  } catch (error) {
    const block = billingBlockOf(error);
    if (block) return Response.json({ error: block.error, code: block.code }, { status: block.status, headers });
    return Response.json({ error: "Não foi possível consultar a Meta agora. Tente novamente em alguns minutos." }, { status: 502, headers });
  }
}
