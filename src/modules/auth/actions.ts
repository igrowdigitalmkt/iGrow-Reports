"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthCookie } from "@/lib/supabase/constants";
import { AGENCY_COOKIE, requireUserSession } from "@/modules/agencies/context";
import { emailSchema, invitationTokenSchema, loginSchema, passwordSchema, signUpSchema, workspaceSchema } from "./schemas";
import { safeRedirect } from "./redirect";
import type { AuthActionState, AuthNoticeState } from "./types";
import { acceptPendingClientInvitations } from "@/modules/client-portal/invitations";
import { markPasswordSet, needsPasswordSetup } from "./password-state";
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
  const { supabase, user } = await requireUserSession("/auth/definir-senha");
  const parsed = passwordSchema.safeParse({ password: formData.get("password"), confirmation: formData.get("confirmation") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Não foi possível salvar a senha. Tente novamente ou solicite um novo convite." };
  await markPasswordSet(user);
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
  const { data, error } = await supabase.auth.setSession({ access_token: parsed.data.accessToken, refresh_token: parsed.data.refreshToken });
  if (error) return { error: "Este link não é válido ou expirou. Solicite um novo convite ao responsável." };
  await acceptPendingClientInvitations(supabase);
  (await cookies()).delete(AGENCY_COOKIE);
  const setup = parsed.data.type === "invite" || parsed.data.type === "recovery" || needsPasswordSetup(data?.user);
  return { redirectTo: setup ? "/auth/definir-senha" : "/dashboard" };
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

async function requestOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host");
  return host ? `${store.get("x-forwarded-proto") ?? "https"}://${host}` : "";
}

// "Esqueceu a senha?": the same answer whether or not the e-mail has an account.
export async function requestPasswordResetAction(_state: AuthNoticeState, formData: FormData): Promise<AuthNoticeState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Não configurado. Peça ao responsável para configurar a autenticação." };
  const origin = await requestOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${origin}/auth/callback?next=/auth/definir-senha` });
  if (error?.status === 429) return { error: "Muitos pedidos seguidos. Aguarde alguns minutos e tente de novo." };
  return { error: null, sent: parsed.data };
}

// "Criar conta": the agency name travels in the account and becomes the workspace after confirmation.
export async function signUpAction(_state: AuthNoticeState, formData: FormData): Promise<AuthNoticeState> {
  const parsed = signUpSchema.safeParse({ name: formData.get("name"), agency: formData.get("agency"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Não configurado. Peça ao responsável para configurar a autenticação." };
  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email, password: parsed.data.password,
    options: { data: { full_name: parsed.data.name, pending_agency_name: parsed.data.agency }, emailRedirectTo: `${origin}/auth/callback?next=/criar-espaco` },
  });
  if (error?.status === 429) return { error: "Muitos cadastros seguidos. Aguarde alguns minutos e tente de novo." };
  if (error) return { error: error.code === "weak_password" ? "Escolha uma senha mais forte." : "Não foi possível criar a conta agora. Tente novamente em instantes." };
  // Projects without e-mail confirmation return a session right away.
  if (data.session) redirect("/criar-espaco");
  return { error: null, sent: parsed.data.email };
}

// Google sign-in: returns to /auth/callback, which exchanges the code for a session.
export async function googleSignInAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/entrar?estado=nao-configurado");
  const origin = await requestOrigin();
  const next = safeRedirect(formData.get("next"));
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` } });
  if (error || !data.url) redirect("/entrar?erro=google");
  redirect(data.url);
}

// First access without a workspace (sign-up or Google): the person creates their own agency.
export async function createOwnWorkspaceAction(_state: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = workspaceSchema.safeParse(formData.get("agency"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supabase } = await requireUserSession("/criar-espaco");
  const { data: agencyId, error } = await supabase.rpc("create_own_agency", { p_name: parsed.data });
  if (error?.code === "23514") return { error: "Você atingiu o limite de 5 espaços de trabalho próprios." };
  if (error || !agencyId) return { error: "Não foi possível criar o espaço de trabalho agora. Tente novamente." };
  await supabase.auth.updateUser({ data: { pending_agency_name: null } });
  (await cookies()).set(AGENCY_COOKIE, agencyId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
