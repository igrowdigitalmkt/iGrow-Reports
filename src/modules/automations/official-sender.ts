import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sendAutomationPdfByWhatsApp } from "@/modules/whatsapp/server";
import { isReportPdfV2Enabled } from "@/modules/reports/pdf/adapter";
import { loadPdfLayout } from "@/modules/reports/layout-settings";
import { buildPeriodPdf, buildPeriodPdfV2 } from "./period-pdf";
import type { OfficialPdfSender } from "./runner";

/** Builds the period PDF on the server and sends it through the automation's official number. */
export const sendOfficialPdf: OfficialPdfSender = async input => {
  const service = createSupabaseServiceClient();
  if (!service) throw new Error("Serviço indisponível.");
  const source = { clientName: input.clientName, workspaceName: input.workspaceName, data: input.data };
  const modern = isReportPdfV2Enabled() || (await loadPdfLayout(input.agencyId)) === "modern";
  const pdf = modern ? await buildPeriodPdfV2(source) : buildPeriodPdf(source);
  const results = await sendAutomationPdfByWhatsApp(service, {
    agencyId: input.agencyId, connectionId: input.connectionId, clientId: input.clientId, clientName: input.clientName,
    runId: input.runId, period: pdf.period, recipients: input.recipients, pdf: pdf.blob, filename: pdf.filename,
  });
  return { results, summary: `PDF ${pdf.filename} enviado pela mensagem modelo do número oficial.` };
};
