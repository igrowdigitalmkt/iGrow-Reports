import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type PdfLayout = "classic" | "modern";

// Layout do PDF da organização. Leitura pelo servidor (também para quem abre o relatório pela Área do Cliente).
// Qualquer falha cai no layout clássico: nunca impede a geração do PDF.
export async function loadPdfLayout(agencyId: string): Promise<PdfLayout> {
  try {
    const service = createSupabaseServiceClient();
    if (!service) return "classic";
    const { data } = await service.from("report_settings").select("pdf_layout").eq("agency_id", agencyId).maybeSingle();
    return data?.pdf_layout === "modern" ? "modern" : "classic";
  } catch {
    return "classic";
  }
}
