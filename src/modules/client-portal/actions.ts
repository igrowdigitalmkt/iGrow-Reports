"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSupabaseConfig } from "@/lib/env";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { Database } from "@/types/database";

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

const revokeInviteSchema = z.object({ agencyId: z.uuid(), invitationId: z.uuid() });

export type ClientPortalInviteResult =
  | { success: true; status: "invited" | "signin_link" | "active"; invitation?: { id: string; email: string; createdAt: string; expiresAt: string } }
  | { error: string };

function appLoginUrl() {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return origin ? `${origin}/entrar` : undefined;
}

// The invitation is the grant: it is stored as pending and becomes active
// access when the invited, confirmed account signs in (see
// accept_client_portal_invitations). Email: account invite when there is no
// confirmed account, otherwise a sign-in link.
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

  const { data, error } = await context.supabase.rpc("invite_client_portal_user", {
    p_agency_id: context.agency.id, p_client_id: parsed.data.clientId, p_email: parsed.data.email,
  });
  const row = data?.[0];
  if (error || !row) {
    if (error && isMissingSchemaError(error)) return { error: "Os convites ainda não estão disponíveis: a atualização do banco precisa ser aplicada." };
    return { error: "Não foi possível registrar o convite. Confira o cliente e tente novamente." };
  }
  if (row.already_active) return { success: true, status: "active" };

  const service = createSupabaseServiceClient();
  const config = getSupabaseConfig();
  const revoke = () => context.supabase.rpc("revoke_client_portal_invitation", { p_agency_id: context.agency.id, p_invitation_id: row.invitation_id! });
  if (!service || !config || !row.invitation_id) {
    if (row.invitation_id) await revoke();
    return { error: "O envio de convites está temporariamente indisponível." };
  }

  const redirectTo = appLoginUrl();
  let status: "invited" | "signin_link" = "invited";
  let sendError: { code?: string } | null = null;
  if (!row.existing_account) {
    const result = await service.auth.admin.inviteUserByEmail(parsed.data.email, redirectTo ? { redirectTo } : undefined);
    sendError = result.error;
  }
  // Confirmed accounts, and accounts already invited by Auth before, receive a
  // sign-in link; following it confirms the email and accepts the invitation.
  if (row.existing_account || sendError?.code === "email_exists" || sendError?.code === "user_already_exists") {
    status = "signin_link";
    const anonymous = createClient<Database>(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" } });
    const result = await anonymous.auth.signInWithOtp({ email: parsed.data.email, options: { shouldCreateUser: false, ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) } });
    sendError = result.error;
  }
  if (sendError) {
    await revoke();
    console.error("client-portal-invite-email-failed", { agencyId: context.agency.id, code: sendError.code ?? null });
    return { error: "Não foi possível enviar o e-mail do convite. Tente novamente em alguns minutos." };
  }

  revalidatePath("/dashboard/clientes");
  const now = new Date();
  return { success: true, status, invitation: { id: row.invitation_id, email: parsed.data.email,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() } };
}

export async function revokeClientPortalInvitation(input: unknown): Promise<ClientPortalAccessResult> {
  const context = await requireAgencyContext();
  if (!canManageAgency(context.role)) return { error: "Somente proprietário ou administrador pode cancelar convites." };
  const parsed = revokeInviteSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "Solicitação inválida. Atualize a página e tente novamente." };
  const { error } = await context.supabase.rpc("revoke_client_portal_invitation", { p_agency_id: context.agency.id, p_invitation_id: parsed.data.invitationId });
  if (error) return { error: "Não foi possível cancelar o convite. Atualize a página e tente novamente." };
  revalidatePath("/dashboard/clientes");
  return { success: true };
}
