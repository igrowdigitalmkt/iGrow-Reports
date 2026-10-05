"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireClientDashboardAccess } from "./context";
import { resolveSeriesIdentities, resolveSeriesMissingIdentities } from "./snapshot-series-loader";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enqueueDailyCollectionJobs, requestDailyMetaCollectionRefresh } from "@/modules/integrations/repository";
import { scheduleMetaQueueDrain } from "@/modules/meta/inline-drain";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";

export async function requestSeriesData(input: unknown) {
  const parsed = z.object({
    clientId: z.uuid(),
    accountId: z.uuid(),
    from: z.iso.date(),
    to: z.iso.date(),
    refresh: z.boolean().optional(),
  }).safeParse(input);
  if (!parsed.success) return { error: "Cliente, conta ou período inválidos." };

  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect) return { error: "Seu perfil não pode solicitar a coleta deste cliente." };

  try {
    if (parsed.data.refresh) {
      // Identities come from the authenticated catalog, never from client input.
      const identities = await resolveSeriesIdentities(context.supabase, parsed.data.clientId, parsed.data.accountId, parsed.data.from, parsed.data.to);
      const service = createSupabaseServiceClient();
      if (!service) return { error: "A coleta está temporariamente indisponível." };
      const result = await requestDailyMetaCollectionRefresh(service, identities);
      scheduleMetaQueueDrain(service);
      revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
      return { success: true as const, created: result.created + result.rescheduled };
    }
    const identities = await resolveSeriesMissingIdentities(
      context.supabase,
      parsed.data.clientId,
      parsed.data.accountId,
      parsed.data.from,
      parsed.data.to,
    );
    if (!identities.length) return { error: "Todos os dias deste período já têm coleta confirmada ou aguardam verificação." };

    const service = createSupabaseServiceClient();
    if (!service) return { error: "A coleta está temporariamente indisponível." };

    const created = await enqueueDailyCollectionJobs(service, identities);
    scheduleMetaQueueDrain(service);
    revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
    return { success: true as const, created };
  } catch (error) {
    if (error instanceof CollectionSchemaUnavailableError) return { error: error.message };
    return { error: "Não foi possível solicitar os dados da série. Tente novamente." };
  }
}
