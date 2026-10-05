import type { Metadata } from "next";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import { SnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard";
import { loadSnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard-loader";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";
import { SnapshotUnavailable } from "@/modules/client-portal/snapshot-unavailable";

export const metadata: Metadata = { title: "Análise confirmada",robots: { index: false,follow: false },referrer: "no-referrer" };
export default async function SnapshotDashboardPage({ params,searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ periodo?: string; from?: string; to?: string; accounts?: string; compare?: string }>;
}) {
  const { clientId } = await params;
  const { supabase,user,access,accesses,agencyMode,canCollect } = await requireClientDashboardAccess(clientId);
  const query = await searchParams;
  let data = null;
  try {
    data = await loadSnapshotDashboard(supabase,clientId,query);
  } catch (error) {
    if (!(error instanceof CollectionSchemaUnavailableError)) throw error;
  }
  return <ClientPortalShell title={access.client.name} description="Desempenho confirmado por conta, campanha, conjunto e anúncio."
    userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={!agencyMode && accesses.length > 1}>
    {data ? <SnapshotDashboard key={JSON.stringify([data.dateFrom,data.dateTo,data.selectedAccountIds,Boolean(data.comparison)])} data={data} clientId={clientId} canCollect={canCollect} />
      : <SnapshotUnavailable clientId={clientId} />}
  </ClientPortalShell>;
}
