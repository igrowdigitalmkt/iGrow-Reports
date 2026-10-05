import type { Metadata } from "next";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import { SnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard";
import { loadSnapshotDashboard } from "@/modules/client-portal/snapshot-dashboard-loader";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";
import { SnapshotUnavailable } from "@/modules/client-portal/snapshot-unavailable";
import { SnapshotSeriesSection } from "@/modules/client-portal/snapshot-series-section";

// Server Actions on this page drain the collection queue after responding (inline-drain.ts).
export const maxDuration = 300;
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

  // Determine which account to use for the daily series (first selected account)
  const seriesAccountId = data?.selectedAccountIds[0] ?? null;

  return <ClientPortalShell title={access.client.name} description="Desempenho confirmado por conta, campanha, conjunto e anúncio."
    userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={!agencyMode && accesses.length > 1}>
    {data ? <>
      <SnapshotDashboard key={JSON.stringify([data.dateFrom,data.dateTo,data.selectedAccountIds,Boolean(data.comparison)])} data={data} clientId={clientId} canCollect={canCollect} />
      {seriesAccountId && (
        <SnapshotSeriesSection
          client={supabase}
          clientId={clientId}
          accountId={seriesAccountId}
          dateFrom={data.dateFrom}
          dateTo={data.dateTo}
          canCollect={canCollect}
        />
      )}
    </> : <SnapshotUnavailable clientId={clientId} />}
  </ClientPortalShell>;
}
