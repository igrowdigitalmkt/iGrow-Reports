"use server";

import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { collectClientMetaData } from "@/modules/meta/actions";
import { resolveAnalyticsRange } from "./range";

export async function collectDashboardData(input: unknown) {
  const context = await requireAgencyContext();
  const parsed = z.object({ clientId: z.uuid(), from: z.string(), to: z.string() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente ou período inválido." };
  try {
    resolveAnalyticsRange({ periodo: "custom", from: parsed.data.from, to: parsed.data.to }, context.agency.timezone);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Período inválido." };
  }
  return collectClientMetaData({ agencyId: context.agency.id, clientId: parsed.data.clientId, since: parsed.data.from, until: parsed.data.to });
}
