"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AGENCY_COOKIE, requireAgencyContext, requireUserSession } from "./context";

export async function selectAgencyAction(formData: FormData) {
  const { supabase, user } = await requireUserSession();
  const id = z.uuid().safeParse(formData.get("agency_id"));
  if (!id.success) redirect("/selecionar-espaco?erro=espaco-invalido");

  const { data, error } = await supabase.from("agency_users").select("agency_id")
    .eq("agency_id", id.data).eq("user_id", user.id).maybeSingle();
  if (error || !data) redirect("/selecionar-espaco?erro=acesso-negado");

  (await cookies()).set(AGENCY_COOKIE, data.agency_id, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}


/** Renomeia o espaço de trabalho (só proprietário ou administrador; o banco confere de novo pela política de acesso). */
export async function renameWorkspaceAction(input: unknown): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const parsed = z.object({ name: z.string().trim().min(2, "Use ao menos 2 letras.").max(120, "Use no máximo 120 letras.") }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Nome inválido." };
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return { ok: false, message: "Somente proprietário ou administrador pode mudar o nome." };
  const name = parsed.data.name.replace(/s+/g, " ");
  const { data, error } = await context.supabase.from("agencies").update({ name }).eq("id", context.agency.id).select("id");
  if (error || !data?.length) return { ok: false, message: "Não foi possível salvar o nome agora. Tente de novo." };
  revalidatePath("/", "layout");
  return { ok: true, name };
}
