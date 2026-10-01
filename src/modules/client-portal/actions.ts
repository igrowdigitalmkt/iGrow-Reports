"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canManageAgency } from "@/modules/agencies/roles";

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
    return { error: "A agência selecionada mudou. Recarregue a página." };
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
    return { error: "A agência selecionada mudou. Recarregue a página." };
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
