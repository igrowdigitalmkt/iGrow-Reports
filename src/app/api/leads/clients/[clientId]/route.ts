import { authorizeLeadsClient } from "@/modules/lead-pages/hub-access";
import { loadLeadEvents, queryBoard } from "@/modules/lead-pages/hub-query";
import { syncStaleSources } from "@/modules/lead-pages/hub-sync";
import { parseFilters } from "@/modules/lead-pages/hub-types";
import { after } from "next/server";
import { loadPerformance } from "@/modules/lead-pages/hub-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Painel de leads de um cliente para a tela (atualização ao vivo), por sessão: equipe da organização ou cliente do portal.
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const access = await authorizeLeadsClient(clientId);
  if (!access.allowed) return Response.json({ error: "forbidden" }, { status: 403, headers });
  const url = new URL(request.url);
  const history = url.searchParams.get("historico");
  if (history) {
    if (!UUID.test(history)) return Response.json({ error: "bad_request" }, { status: 400, headers });
    const events = await loadLeadEvents(access.service, { clientId: access.clientId, leadId: history, restrictFormIds: access.restrictFormIds });
    return events ? Response.json({ events }, { headers }) : Response.json({ error: "not_found" }, { status: 404, headers });
  }
  const performance = url.searchParams.get("desempenho");
  if (performance) {
    if (!access.supabase) return Response.json({ error: "forbidden" }, { status: 403, headers });
    const data = await loadPerformance({ service: access.service, supabase: access.supabase, clientId: access.clientId, period: performance });
    return data ? Response.json(data, { headers }) : Response.json({ error: "unavailable" }, { status: 503, headers });
  }
  const board = await queryBoard(access.service, { clientId: access.clientId, restrictFormIds: access.restrictFormIds, filters: parseFilters(url.searchParams) });
  if (!board) return Response.json({ error: "unavailable" }, { status: 503, headers });
  // Completa em segundo plano o que o aviso em tempo real possa ter deixado passar (no máximo a cada 2 minutos por fonte).
  after(() => syncStaleSources(access.service, access.clientId).catch(() => undefined));
  return Response.json(board, { headers });
}
