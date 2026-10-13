"use server";

import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getFreshClientAnalytics } from "@/modules/client-portal/analytics-live";
import { normalizeHierarchy } from "@/modules/client-portal/analytics-hierarchy";
import { EMPTY_PROFILE, PROFILE_FIELDS, PROFILE_NUDGE, profileCompleteness, profileForPrompt, type ClientProfile } from "@/modules/clients/profile";
import { buildReportFacts } from "@/modules/reports/report-facts";
import { confirmedReportData } from "@/modules/reports/report-presentation";
import { generateReportComment } from "./report-comment";

const inputSchema = z.object({
  clientId: z.uuid(), dateFrom: z.iso.date(), dateTo: z.iso.date(),
  accountIds: z.array(z.uuid()).min(1).max(100),
  // Informados à mão pelo responsável; ambos opcionais.
  sales: z.number().int().min(0).max(1_000_000).optional(),
  revenue: z.number().min(0).max(1_000_000_000).optional(),
});

export type CommentDraftResult =
  | { ok: true; text: string; profileFilled: number; profileTotal: number; nudge: string | null }
  | { ok: false; message: string };

// Gera o rascunho do comentário a partir dos dados confirmados no servidor (nunca de números enviados pelo navegador).
// O texto é só um rascunho: o responsável revisa antes de gerar o relatório.
export async function generateCommentDraft(input: unknown): Promise<CommentDraftResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Período ou contas inválidos para gerar o comentário." };
  const { clientId, dateFrom, dateTo, accountIds, sales, revenue } = parsed.data;
  const context = await requireClientDashboardAccess(clientId);
  if (!context.agencyMode || !context.canManageReports) return { ok: false, message: "Seu perfil não pode gerar comentários com IA neste cliente." };

  const analytics = await getFreshClientAnalytics({
    supabase: context.supabase, agencyId: context.access.agencyId, clientId, dateFrom, dateTo, accountIds,
  });
  if (analytics.coverage.status !== "complete") {
    return { ok: false, message: "O comentário só é gerado quando todos os dias do período estão confirmados. Atualize os dados e tente de novo." };
  }

  if (!analytics.metaAggregate?.confirmed) {
    return { ok: false, message: "A Meta ainda não confirmou os números agregados deste período. Atualize os dados e tente de novo." };
  }

  // Os resultados por tipo do período anterior só existem depois de a Meta confirmar o agregado desse período.
  // Confirma o anterior como um período próprio e usa o resumo dele na comparação (sem isso, só custo atual).
  let comparison = analytics;
  if (analytics.coverage.previousStatus === "complete") {
    try {
      const previous = await getFreshClientAnalytics({
        supabase: context.supabase, agencyId: context.access.agencyId, clientId,
        dateFrom: analytics.previousDateFrom, dateTo: analytics.previousDateTo, accountIds,
      });
      if (previous.coverage.status === "complete" && previous.metaAggregate?.confirmed) comparison = { ...analytics, previousSummary: previous.summary };
    } catch { /* sem confirmação do anterior, a comparação de resultados fica indisponível e os fatos avisam */ }
  }

  const hierarchy = async (from: string, to: string) => {
    const { data, error } = await context.supabase.rpc("get_client_analytics_hierarchy", {
      p_client_id: clientId, p_date_from: from, p_date_to: to, p_ad_account_ids: accountIds,
    });
    return error || !data ? [] : normalizeHierarchy(data);
  };
  const [entities, previousEntities] = await Promise.all([
    hierarchy(dateFrom, dateTo),
    analytics.coverage.previousStatus === "complete" ? hierarchy(analytics.previousDateFrom, analytics.previousDateTo) : Promise.resolve([]),
  ]);

  const { data: profileRow } = await context.supabase.from("client_profiles")
    .select(PROFILE_FIELDS.map(item => item.key).join(",")).eq("client_id", clientId).maybeSingle();
  const profile: ClientProfile = { ...EMPTY_PROFILE, ...((profileRow ?? {}) as unknown as Partial<ClientProfile>) };

  const facts = buildReportFacts(confirmedReportData(comparison), entities, previousEntities, sales == null ? undefined : { sales, revenue });
  const result = await generateReportComment({
    agencyId: context.access.agencyId, clientId, userId: context.user.id, facts,
    profile: profileForPrompt(profile), sourceRef: `${dateFrom}..${dateTo}`,
  });
  if (!result.ok) return { ok: false, message: result.message };
  const progress = profileCompleteness(profile);
  return { ok: true, text: result.text, profileFilled: progress.filled, profileTotal: progress.total, nudge: progress.complete ? null : PROFILE_NUDGE };
}
