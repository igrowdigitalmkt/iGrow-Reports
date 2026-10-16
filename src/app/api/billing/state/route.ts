import { requireAgencyContext } from "@/modules/agencies/context";
import { asBillingDb, callRpc } from "@/modules/billing/db";
import { deriveContractView, parseBillingSnapshot, parseReturnHint } from "@/modules/billing/status-view";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

// Estado resumido da contratação para o acompanhamento da página de retorno: UMA consulta ao banco (a mesma da tela), sem recarregar
// o painel. Somente leitura: não ativa, altera nem libera nada. O banco confere papel e organização.
export async function GET(request: Request) {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return Response.json({ error: "Sem permissão." }, { status: 403, headers });
  const billing = await callRpc(asBillingDb(context.supabase), "get_agency_billing", { p_agency_id: context.agency.id }).then(parseBillingSnapshot, () => null);
  const view = deriveContractView(billing, parseReturnHint(new URL(request.url).searchParams.get("e")));
  return Response.json({ state: view.state, polling: view.polling }, { headers });
}
