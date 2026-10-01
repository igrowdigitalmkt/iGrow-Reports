"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { clientInputSchema, type ClientResult } from "./schema";

const fields = "id,name,notes,archived_at,updated_at";

export async function saveClient(input: unknown): Promise<ClientResult> {
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Seu perfil permite apenas consultar clientes." };
  const parsed = clientInputSchema.extend({ id: z.uuid().optional(), agencyId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, agencyId, name, notes } = parsed.data;
  if (agencyId !== context.agency.id) return { error: "O espaço de trabalho selecionado mudou. Recarregue a página antes de salvar." };
  const query = id
    ? context.supabase.from("clients").update({ name, notes: notes || null }).eq("agency_id", context.agency.id).eq("id", id).is("archived_at", null)
    : context.supabase.from("clients").insert({ agency_id: context.agency.id, name, notes: notes || null });
  const { data, error } = await query.select(fields).maybeSingle();
  if (error || !data) return { error: "Não foi possível salvar. O cliente pode ter sido arquivado ou seu acesso alterado. Atualize e tente novamente." };
  revalidatePath("/dashboard", "page");
  revalidatePath("/dashboard/clientes");
  return { client: data };
}

export async function setClientArchived(input: unknown): Promise<ClientResult> {
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Seu perfil permite apenas consultar clientes." };
  const parsed = z.object({ id: z.uuid(), agencyId: z.uuid(), archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: "Solicitação inválida. Atualize a página." };
  if (parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho selecionado mudou. Recarregue a página." };
  const { data, error } = await context.supabase.from("clients")
    .update({ archived_at: parsed.data.archived ? new Date().toISOString() : null })
    .eq("agency_id", context.agency.id).eq("id", parsed.data.id).select(fields).maybeSingle();
  if (error || !data) return { error: "Não foi possível alterar este cliente. Atualize a página e confira seu acesso." };
  revalidatePath("/dashboard", "page");
  revalidatePath("/dashboard/clientes");
  return { client: data };
}
