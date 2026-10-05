import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadSnapshotSeries, type SnapshotSeriesData } from "./snapshot-series-loader";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";
import { SnapshotSeriesPanel } from "./snapshot-series-panel";

// Max days for on-demand series loading without a background cache.
// Beyond this the user gets a prompt to narrow the period.
const MAX_SERIES_DAYS = 90;

function dayCount(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export async function SnapshotSeriesSection({
  client,
  clientId,
  accountId,
  dateFrom,
  dateTo,
  canCollect,
}: {
  client: SupabaseClient<Database>;
  clientId: string;
  accountId: string;
  dateFrom: string;
  dateTo: string;
  canCollect: boolean;
}) {
  const days = dayCount(dateFrom, dateTo);
  if (days > MAX_SERIES_DAYS) {
    return (
      <SnapshotSeriesPanel
        clientId={clientId} accountId={accountId} dateFrom={dateFrom} dateTo={dateTo}
        canCollect={canCollect} series={null} tooManyDays={days} maxDays={MAX_SERIES_DAYS}
      />
    );
  }

  let series: SnapshotSeriesData | null = null;
  try {
    series = await loadSnapshotSeries(client, clientId, accountId, dateFrom, dateTo);
  } catch (error) {
    if (!(error instanceof CollectionSchemaUnavailableError)) throw error;
  }

  return (
    <SnapshotSeriesPanel
      clientId={clientId} accountId={accountId} dateFrom={dateFrom} dateTo={dateTo}
      canCollect={canCollect} series={series} tooManyDays={null} maxDays={MAX_SERIES_DAYS}
    />
  );
}
