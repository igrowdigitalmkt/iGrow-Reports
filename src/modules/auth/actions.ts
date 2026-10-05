"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthCookie } from "@/lib/supabase/constants";
import { AGENCY_COOKIE, requireUserSession } from "@/modules/agencies/context";
import { invitationTokenSchema, loginSchema, passwordSchema } from "./schemas";
import { safeRedirect } from "./redirect";
import type { AuthActionState } from "./types";
import { acceptPendingClientInvitations } from "@/modules/client-portal/invitations";
import { z } from "zod";

export async function loginAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Não configurado. Peça ao responsável para configurar a autenticação." };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Não foi possível entrar. Confira seu e-mail e senha ou tente novamente em instantes." };
  await acceptPendingClientInvitations(supabase);
  (await cookies()).delete(AGENCY_COOKIE);
  revalidatePath("/", "layout");
  redirect(safeRedirect(formData.get("next")));
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  try {
    if (supabase) await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Local logout must still complete if the provider is temporarily unavailable.
  }
  // Clear this app's cookies even when a session refresh fails during signOut.
  const cookieStore = await cookies();
  cookieStore.getAll().filter(({ name }) => isAuthCookie(name)).forEach(({ name }) => cookieStore.delete(name));
  cookieStore.delete(AGENCY_COOKIE);
  revalidatePath("/", "layout");
  redirect("/entrar");
}

export async function setPasswordAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const { supabase } = await requireUserSession("/auth/definir-senha");
  const parsed = passwordSchema.safeParse({ password: formData.get("password"), confirmation: formData.get("confirmation") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Não foi possível salvar a senha. Tente novamente ou solicite um novo convite." };
  await acceptPendingClientInvitations(supabase);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

const linkSessionSchema = z.object({
  accessToken: z.string().min(20).max(4096),
  refreshToken: z.string().min(8).max(1024),
  type: z.enum(["invite","recovery","magiclink","signup","email"]).nullable(),
});

// Email links from Supabase's default templates return the session in the URL
// fragment, which the server never receives. The browser hands it over once;
// the session is validated by Supabase before any cookie is written.
export async function establishLinkSessionAction(input: unknown): Promise<{ error: string } | { redirectTo: string }> {
  const parsed = linkSessionSchema.safeParse(input);
  if (!parsed.success) return { error: "Este link não é válido ou expirou. Solicite um novo convite ao responsável." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Não configurado. Peça ao responsável para configurar a autenticação." };
  const { error } = await supabase.auth.setSession({ access_token: parsed.data.accessToken, refresh_token: parsed.data.refreshToken });
  if (error) return { error: "Este link não é válido ou expirou. Solicite um novo convite ao responsável." };
  await acceptPendingClientInvitations(supabase);
  (await cookies()).delete(AGENCY_COOKIE);
  return { redirectTo: parsed.data.type === "invite" || parsed.data.type === "recovery" ? "/auth/definir-senha" : "/dashboard" };
}

export async function acceptInvitationAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = invitationTokenSchema.safeParse(formData.get("token"));
  if (!parsed.success) return { error: "Este convite é inválido. Solicite um novo link ao responsável pelo espaço de trabalho." };
  const { supabase } = await requireUserSession(`/convite?token=${parsed.data}`);
  const { data: agencyId, error } = await supabase.rpc("accept_agency_invitation", { p_token: parsed.data });
  if (error || !agencyId) return { error: "Não foi possível aceitar o convite. Confira se este é o e-mail convidado e se o link ainda é válido." };
  (await cookies()).set(AGENCY_COOKIE, agencyId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
