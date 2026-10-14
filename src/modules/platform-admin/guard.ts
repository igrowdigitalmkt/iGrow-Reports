import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePlatformAccess, type PlatformAccess, type PlatformOperator } from "./access";

const loadAccess = cache(async () => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { supabase: null, access: { state: "error" } as PlatformAccess };
  return { supabase, access: await resolvePlatformAccess(supabase) };
});

/**
 * Guarda de página do Super Admin. Cada página e server action reconfere o acesso: layouts não rodam
 * de novo a cada navegação e o proxy só renova a sessão. Quem não é operador recebe 404.
 */
export async function requirePlatformOperator() {
  const { supabase, access } = await loadAccess();
  if (!supabase) redirect("/entrar?estado=nao-configurado");
  switch (access.state) {
    case "granted": return { supabase, operator: access.operator };
    case "mfa_required": redirect("/admin/mfa");
    case "unauthenticated": redirect("/entrar?next=%2Fadmin");
    case "not_operator": notFound();
    default: throw new Error("Não foi possível verificar o acesso administrativo.");
  }
}

/** Para a tela de MFA: aceita operador ainda sem o segundo fator validado (aal1) ou já validado. */
export async function requirePlatformOperatorForMfa() {
  const { supabase, access } = await loadAccess();
  if (!supabase) redirect("/entrar?estado=nao-configurado");
  switch (access.state) {
    case "granted":
    case "mfa_required": return { supabase, operator: access.operator, mfaVerified: access.state === "granted" };
    case "unauthenticated": redirect("/entrar?next=%2Fadmin%2Fmfa");
    case "not_operator": notFound();
    default: throw new Error("Não foi possível verificar o acesso administrativo.");
  }
}

/** Server actions do fluxo de MFA (sem cache de renderização). */
export async function authorizePlatformMfaAction(): Promise<
  { ok: true; supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>; operator: PlatformOperator; mfaVerified: boolean } | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Autenticação não configurada." };
  const access = await resolvePlatformAccess(supabase);
  if (access.state === "granted" || access.state === "mfa_required") return { ok: true, supabase, operator: access.operator, mfaVerified: access.state === "granted" };
  return { ok: false, error: access.state === "unauthenticated" ? "Sua sessão expirou. Entre novamente." : "Acesso não autorizado." };
}

/** Server actions administrativas: operador com MFA validado, reconferido a cada chamada. */
export async function authorizePlatformAction(): Promise<
  { ok: true; supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>; operator: PlatformOperator } | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Autenticação não configurada." };
  const access = await resolvePlatformAccess(supabase);
  if (access.state === "granted") return { ok: true, supabase, operator: access.operator };
  return { ok: false, error: access.state === "unauthenticated" ? "Sua sessão expirou. Entre novamente." : access.state === "mfa_required" ? "Confirme a verificação em duas etapas para continuar." : "Acesso não autorizado." };
}

/** APIs administrativas: sempre operador com MFA validado. Respostas sem cache e sem detalhes internos. */
export async function authorizePlatformApi(): Promise<{ ok: true; operator: PlatformOperator } | { ok: false; response: NextResponse }> {
  const supabase = await createSupabaseServerClient();
  const access: PlatformAccess = supabase ? await resolvePlatformAccess(supabase) : { state: "error" };
  if (access.state === "granted") return { ok: true, operator: access.operator };
  const [status, error] = access.state === "unauthenticated" ? [401, "unauthenticated"]
    : access.state === "mfa_required" ? [403, "mfa_required"]
    : access.state === "not_operator" ? [404, "not_found"] : [503, "unavailable"];
  return { ok: false, response: NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } }) };
}
