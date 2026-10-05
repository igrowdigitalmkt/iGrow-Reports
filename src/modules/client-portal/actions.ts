"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const accessSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  userId: z.uuid(),
  active: z.boolean(),
});

const emailAccessSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  email: z.string().trim().email().max(254),
  active: z.boolean(),
});

export type ClientPortalAccessResult =
  | { success: true; userId?: string }
  | { error: string };

export async function setClientPortalAccess(
  input: unknown,
): Promise<ClientPortalAccessResult> {
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) {
    return { error: "Somente proprietário ou administrador pode gerenciar acessos de clientes." };
  }
  const parsed = accessSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Solicitação inválida. Atualize a página e tente novamente." };
  }
  if (parsed.data.agencyId !== context.agency.id) {
    return { error: "O espaço de trabalho selecionado mudou. Recarregue a página." };
  }

  const { error } = await context.supabase.rpc("set_client_user_access", {
    p_agency_id: context.agency.id,
    p_client_id: parsed.data.clientId,
    p_user_id: parsed.data.userId,
    p_active: parsed.data.active,
  });

  if (error) {
    return {
      error: parsed.data.active
        ? "Não foi possível liberar o acesso. Confira o cliente e a conta do usuário."
        : "Não foi possível revogar o acesso. Atualize a página e tente novamente.",
    };
  }

  revalidatePath("/dashboard/clientes");
  return { success: true };
}

export async function setClientPortalAccessByEmail(
  input: unknown,
): Promise<ClientPortalAccessResult> {
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) {
    return { error: "Somente proprietário ou administrador pode gerenciar acessos de clientes." };
  }

  const parsed = emailAccessSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Informe um e-mail válido e tente novamente." };
  }
  if (parsed.data.agencyId !== context.agency.id) {
    return { error: "O espaço de trabalho selecionado mudou. Recarregue a página." };
  }

  const { data, error } = await context.supabase.rpc("set_client_user_access_by_email", {
    p_agency_id: context.agency.id,
    p_client_id: parsed.data.clientId,
    p_email: parsed.data.email,
    p_active: parsed.data.active,
  });

  if (error) {
    return {
      error: parsed.data.active
        ? "Não foi possível liberar o acesso. A conta precisa existir no iGrow Reports e estar com o e-mail confirmado."
        : "Não foi possível revogar o acesso. Atualize a página e tente novamente.",
    };
  }

  revalidatePath("/dashboard/clientes");
  revalidatePath("/cliente");
  revalidatePath(`/cliente/${parsed.data.clientId}`);
  return { success: true, userId: data };
}

const inviteSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
});

export type ClientPortalInviteResult =
  | { success: true; status: "invited" | "exists" }
  | { error: string };

// Step 1 of granting access to someone without an account: Supabase Auth sends
// the invite (template link to /auth/confirmar). Access is granted in step 2 with
// setClientPortalAccessByEmail, which still requires a confirmed email.
export async function inviteClientPortalUser(input: unknown): Promise<ClientPortalInviteResult> {
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) {
    return { error: "Somente proprietário ou administrador pode convidar clientes." };
  }
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: "Informe um e-mail válido e tente novamente." };
  if (parsed.data.agencyId !== context.agency.id) {
    return { error: "O espaço de trabalho selecionado mudou. Recarregue a página." };
  }

  const { data: client } = await context.supabase.from("clients").select("id")
    .eq("agency_id", context.agency.id).eq("id", parsed.data.clientId).is("archived_at", null).maybeSingle();
  if (!client) return { error: "Cliente indisponível ou arquivado." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "O envio de convites está temporariamente indisponível." };

  const { data, error } = await service.auth.admin.inviteUserByEmail(parsed.data.email);
  if (error) {
    // Existing accounts are not re-invited; the operator grants access directly.
    if (error.code === "email_exists" || error.code === "user_already_exists") return { success: true, status: "exists" };
    console.error("client-portal-invite-failed", { agencyId: context.agency.id, code: error.code ?? null });
    return { error: "Não foi possível enviar o convite. Tente novamente mais tarde." };
  }

  await service.from("audit_logs").insert({
    agency_id: context.agency.id,
    actor_id: context.user.id,
    action: "client_portal.invited",
    entity_id: parsed.data.clientId,
    metadata: { invited_user_id: data.user?.id ?? null },
  });
  return { success: true, status: "invited" };
}

