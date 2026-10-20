import { z } from "zod";
import { billingBlockOf } from "@/modules/billing/guard";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getClientAccountBilling } from "@/modules/meta/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { loadGoogleBilling } from "@/modules/google-ads/provider";

export const runtime = "nodejs";

// A route handler (not a server action) so the billing read runs in parallel with
// the dashboard's other requests instead of waiting in the action queue.
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const parsed = z.uuid().safeParse((await params).clientId);
  if (!parsed.success) return Response.json({ error: "Cliente inválido." }, { status: 400, headers });
  const { access } = await requireClientDashboardAccess(parsed.data);
  const service = createSupabaseServiceClient();
  // Meta e Google são lidos em paralelo; uma plataforma indisponível não esconde a outra.
  const [meta, google] = await Promise.allSettled([
    getClientAccountBilling({ agencyId: access.agencyId, clientId: parsed.data }),
    service ? loadGoogleBilling({ service, agencyId: access.agencyId, clientId: parsed.data }) : Promise.resolve({ accounts: [], failures: [] as string[] }),
  ]);
  const rejected = [meta, google].find((result): result is PromiseRejectedResult => result.status === "rejected");
  const block = rejected ? billingBlockOf(rejected.reason) : null;
  if (block) return Response.json({ error: block.error, code: block.code }, { status: block.status, headers });
  if (meta.status === "rejected" && google.status === "rejected") return Response.json({ error: "Não foi possível consultar as plataformas agora. Tente novamente em alguns minutos." }, { status: 502, headers });
  const accounts = [
    ...(meta.status === "fulfilled" ? meta.value.map(account => ({ ...account, platform: "meta" as const })) : []),
    ...(google.status === "fulfilled" ? google.value.accounts : []),
  ];
  const failures = [
    ...(meta.status === "rejected" ? ["Meta Ads"] : []),
    ...(google.status === "fulfilled" ? google.value.failures : ["Google Ads"]),
  ];
  return Response.json({ accounts, failures }, { headers });
}
