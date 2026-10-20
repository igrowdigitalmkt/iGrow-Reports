import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Endereço antigo e global. Campanhas agora pertence ao menu do cliente (/clientes/ID/campanhas). Esta rota não renderiza interface:
 * só encaminha, mantendo o período e os filtros, e sem cliente válido leva à lista de clientes (nunca escolhe um cliente por conta própria).
 */
export default async function LegacyCampaignsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const clientId = typeof raw.cliente === "string" ? raw.cliente : "";
  if (!UUID.test(clientId)) redirect("/clientes");
  const params = new URLSearchParams();
  for (const key of ["periodo", "from", "to", "contas", "ativas"] as const) { const value = raw[key]; if (typeof value === "string") params.set(key, value); }
  const search = params.toString();
  redirect(`/clientes/${clientId}/campanhas${search ? `?${search}` : ""}`);
}
