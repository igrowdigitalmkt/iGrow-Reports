"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";

const scope = z.object({ agencyId: z.uuid() });
const isAdmin = (role: string) => role === "owner" || role === "admin";
export type PdfLayoutResult = { error: string } | { layout: "classic" | "modern" };

export async function getPdfLayoutSetting(input: unknown): Promise<PdfLayoutResult> {
  const context = await requireAgencyContext();
  const parsed = scope.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { data, error } = await context.supabase.from("report_settings").select("pdf_layout").eq("agency_id", context.agency.id).maybeSingle();
  if (error) return { error: "Não foi possível carregar o layout do PDF." };
  return { layout: data?.pdf_layout === "modern" ? "modern" : "classic" };
}

export async function savePdfLayoutSetting(input: unknown): Promise<PdfLayoutResult> {
  const context = await requireAgencyContext();
  const parsed = scope.extend({ layout: z.enum(["classic", "modern"]) }).safeParse(input);
  if (!parsed.success) return { error: "Escolha um layout válido." };
  if (parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores escolhem o layout do PDF." };
  const { error } = await context.supabase.from("report_settings").upsert({
    agency_id: context.agency.id, pdf_layout: parsed.data.layout, updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "agency_id" });
  if (error) return { error: "Não foi possível salvar. Confira seu acesso e tente novamente." };
  revalidatePath("/dashboard/configuracoes");
  return { layout: parsed.data.layout };
}
