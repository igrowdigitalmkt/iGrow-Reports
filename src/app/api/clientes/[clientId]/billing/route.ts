import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getClientAccountBilling } from "@/modules/meta/server";

export const runtime = "nodejs";

// A route handler (not a server action) so the billing read runs in parallel with
// the dashboard's other requests instead of waiting in the action queue.
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const parsed = z.uuid().safeParse((await params).clientId);
  if (!parsed.success) return Response.json({ error: "Cliente inválido." }, { status: 400, headers });
  const { access } = await requireClientDashboardAccess(parsed.data);
  try {
    return Response.json({ accounts: await getClientAccountBilling({ agencyId: access.agencyId, clientId: parsed.data }) }, { headers });
  } catch {
    return Response.json({ error: "Não foi possível consultar a Meta agora. Tente novamente em alguns minutos." }, { status: 502, headers });
  }
}
