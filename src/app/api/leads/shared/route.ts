import { authorizeLeadsLink } from "@/modules/lead-pages/hub-access";
import { addLeadNote, changeLeadStatus, loadLeadEvents, queryBoard } from "@/modules/lead-pages/hub-query";
import { syncStaleSources } from "@/modules/lead-pages/hub-sync";
import { isLeadStatus, parseFilters } from "@/modules/lead-pages/hub-types";
import { after } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Link compartilhado (sem login): o código vai no cabeçalho, nunca na URL, e é conferido a cada pedido. Sem código válido: 404 igual.
export async function GET(request: Request) {
  const access = await authorizeLeadsLink(request.headers.get("x-lead-code"), { touch: true });
  if (!access) return Response.json({ error: "not_found" }, { status: 404, headers });
  const url = new URL(request.url);
  const history = url.searchParams.get("historico");
  if (history) {
    if (!UUID.test(history)) return Response.json({ error: "bad_request" }, { status: 400, headers });
    const events = await loadLeadEvents(access.service, { clientId: access.clientId, leadId: history, restrictFormIds: access.restrictFormIds });
    return events ? Response.json({ events }, { headers }) : Response.json({ error: "not_found" }, { status: 404, headers });
  }
  const board = await queryBoard(access.service, { clientId: access.clientId, restrictFormIds: access.restrictFormIds, filters: parseFilters(url.searchParams) });
  if (!board) return Response.json({ error: "unavailable" }, { status: 503, headers });
  after(() => syncStaleSources(access.service, access.clientId).catch(() => undefined));
  return Response.json({ ...board, canUpdate: access.canUpdate, clientName: access.clientName }, { headers });
}

export async function POST(request: Request) {
  const access = await authorizeLeadsLink(request.headers.get("x-lead-code"));
  if (!access) return Response.json({ error: "not_found" }, { status: 404, headers });
  if (!access.canUpdate) return Response.json({ error: "read_only" }, { status: 403, headers });
  const body = await request.json().catch(() => null) as { action?: unknown; leadId?: unknown; status?: unknown; body?: unknown } | null;
  if (!body || typeof body.leadId !== "string" || !UUID.test(body.leadId)) return Response.json({ error: "bad_request" }, { status: 400, headers });
  const base = { clientId: access.clientId, leadId: body.leadId, restrictFormIds: access.restrictFormIds, actor: access.actor, userId: null };
  const result = body.action === "status" && isLeadStatus(body.status) ? await changeLeadStatus(access.service, { ...base, status: body.status })
    : body.action === "note" && typeof body.body === "string" ? await addLeadNote(access.service, { ...base, body: body.body }) : "error";
  return result === "ok" || result === "same" ? Response.json({ ok: true }, { headers })
    : Response.json({ error: result === "not_found" ? "not_found" : "failed" }, { status: result === "not_found" ? 404 : 400, headers });
}
