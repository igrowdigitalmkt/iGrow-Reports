import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getClientAudienceBreakdowns } from "@/modules/meta/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Platform, gender, age, region and country of the period, read live from Meta. A route handler
// so it runs in parallel with the dashboard's other requests.
export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const clientId = z.uuid().safeParse((await params).clientId);
  const query = new URL(request.url).searchParams;
  const since = date.safeParse(query.get("from"));
  const until = date.safeParse(query.get("to"));
  if (!clientId.success || !since.success || !until.success || until.data < since.data) return Response.json({ error: "Período inválido." }, { status: 400, headers });
  const accountIds = (query.get("contas") ?? "").split(",").filter(id => z.uuid().safeParse(id).success);
  const { access } = await requireClientDashboardAccess(clientId.data);
  try {
    return Response.json(await getClientAudienceBreakdowns({ agencyId: access.agencyId, clientId: clientId.data, since: since.data, until: until.data, accountIds }), { headers });
  } catch {
    return Response.json({ error: "Não foi possível consultar a Meta agora. Tente novamente em alguns minutos." }, { status: 502, headers });
  }
}
