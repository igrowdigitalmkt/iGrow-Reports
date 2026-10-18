"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { EMPTY_PROFILE, PROFILE_FIELDS, profileInputSchema, type ClientProfile } from "./profile";

const columns = PROFILE_FIELDS.map(item => item.key).join(",");
const scope = z.object({ agencyId: z.uuid(), clientId: z.uuid() });
export type ProfileResult = { error: string } | { profile: ClientProfile };

export async function getClientProfile(input: unknown): Promise<ProfileResult> {
  const context = await requireAgencyContext();
  const parsed = scope.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { data, error } = await context.supabase.from("client_profiles").select(columns)
    .eq("client_id", parsed.data.clientId).eq("agency_id", context.agency.id).maybeSingle();
  if (error) return { error: "Não foi possível carregar o perfil do cliente." };
  return { profile: { ...EMPTY_PROFILE, ...((data ?? {}) as unknown as Partial<ClientProfile>) } };
}

export async function saveClientProfile(input: unknown): Promise<ProfileResult> {
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Seu perfil permite apenas consultar clientes." };
  const base = scope.safeParse(input);
  const fields = profileInputSchema.safeParse(input);
  if (!base.success || !fields.success) return { error: fields.success ? "Solicitação inválida. Atualize a página." : fields.error.issues[0]?.message ?? "Revise os campos." };
  if (base.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { data, error } = await context.supabase.from("client_profiles").upsert({
    client_id: base.data.clientId, agency_id: context.agency.id, ...fields.data,
    updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" }).select(columns).maybeSingle();
  if (error || !data) return { error: "Não foi possível salvar o perfil. Confira seu acesso e tente novamente." };
  revalidatePath("/clientes");
  return { profile: { ...EMPTY_PROFILE, ...(data as unknown as Partial<ClientProfile>) } };
}
