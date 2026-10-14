import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export type PlatformAuditEntry = {
  action: string; // padrão "dominio.acao", ex.: admin.mfa_verified
  resourceType?: string;
  resourceId?: string;
  outcome?: "success" | "denied" | "failure";
  metadata?: Record<string, Json>; // nunca segredos, tokens ou códigos
};

/**
 * Registra na trilha da plataforma (platform_audit_log) pela função do banco, que reconfere o operador.
 * Retorna false em falha: os eventos do fluxo de MFA não devem travar o login do operador. Operações
 * administrativas que alteram dados devem gravar a auditoria na mesma função/transação do banco.
 */
export async function recordPlatformAudit(supabase: SupabaseClient<Database>, entry: PlatformAuditEntry): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("platform_record_audit", {
      p_action: entry.action,
      p_resource_type: entry.resourceType ?? null,
      p_resource_id: entry.resourceId ?? null,
      p_outcome: entry.outcome ?? "success",
      p_metadata: entry.metadata ?? {},
    });
    if (error) console.error("Falha ao registrar auditoria da plataforma", { action: entry.action, code: error.code });
    return !error;
  } catch {
    console.error("Falha ao registrar auditoria da plataforma", { action: entry.action });
    return false;
  }
}
