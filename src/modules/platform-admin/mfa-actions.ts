"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { recordPlatformAudit } from "./audit";
import { authorizePlatformMfaAction } from "./guard";

export type MfaEnrollment = { error: string } | { error: null; factorId: string; qrCode: string; secret: string };
export type MfaVerifyState = { error: string | null };

const verifySchema = z.object({ factorId: z.string().uuid(), code: z.string().trim().regex(/^\d{6}$/, "Informe os 6 números do aplicativo autenticador.") });

/** Gera um novo fator TOTP (QR Code) para o operador. Segredo e QR só voltam para o próprio operador. */
export async function startMfaEnrollmentAction(): Promise<MfaEnrollment> {
  const auth = await authorizePlatformMfaAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase, mfaVerified } = auth;
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: "Não foi possível consultar os autenticadores. Tente novamente." };
  // Com um autenticador já validado, só uma sessão com MFA pode cadastrar outro: quem só tem a senha
  // deve informar o código, não trocar o segundo fator.
  if (factors.totp.length > 0 && !mfaVerified) return { error: "Já existe um autenticador cadastrado. Informe o código dele para entrar." };
  // Cadastros abandonados (nunca validados) são descartados para não acumular nem conflitar nomes.
  for (const factor of factors.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const label = `iGrow Admin ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: label, issuer: "iGrow Reports Admin" });
  if (error || !data) return { error: "Não foi possível gerar o QR Code. Confira se a verificação em duas etapas está ativada no Supabase." };
  return { error: null, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Valida o código TOTP. Em caso de sucesso a sessão passa a aal2 (cookies atualizados pelo Supabase). */
export async function verifyMfaAction(_state: MfaVerifyState, formData: FormData): Promise<MfaVerifyState> {
  const parsed = verifySchema.safeParse({ factorId: formData.get("factorId"), code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const auth = await authorizePlatformMfaAction();
  if (!auth.ok) return { error: auth.error };
  const { supabase, operator } = auth;
  // O fator precisa pertencer ao operador autenticado (o Auth também confere).
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  const factor = factors?.all.find((item) => item.id === parsed.data.factorId && item.factor_type === "totp");
  if (listError || !factor) return { error: "Autenticador não encontrado. Recarregue a página." };
  const firstUse = factor.status === "unverified";
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
  if (error) {
    await recordPlatformAudit(supabase, { action: "admin.mfa_failed", resourceType: "platform_operator", resourceId: operator.userId, outcome: "failure" });
    return { error: "Código inválido ou expirado. Confira o aplicativo e tente de novo." };
  }
  await recordPlatformAudit(supabase, { action: firstUse ? "admin.mfa_enrolled" : "admin.mfa_verified", resourceType: "platform_operator", resourceId: operator.userId });
  redirect("/admin");
}
