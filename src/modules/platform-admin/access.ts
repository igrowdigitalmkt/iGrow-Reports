import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Operadores da plataforma (Super Admin). Independente dos papéis das organizações (agency_users):
// ser proprietário de uma organização cliente nunca concede acesso global.
export type PlatformRole = "owner";

export const platformRoleLabels: Record<PlatformRole, string> = { owner: "Proprietário da plataforma" };

export type PlatformOperator = { userId: string; email: string; role: PlatformRole; aal: "aal1" | "aal2" };

export type PlatformAccess =
  | { state: "unauthenticated" }
  | { state: "not_operator" }
  | { state: "mfa_required"; operator: PlatformOperator }
  | { state: "granted"; operator: PlatformOperator }
  | { state: "error" };

/** Lê o retorno de platform_operator_status(); qualquer formato inesperado vale como "não operador". */
export function parseOperatorStatus(value: unknown): { role: PlatformRole; aal: "aal1" | "aal2" } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { role, aal } = value as { role?: unknown; aal?: unknown };
  if (role !== "owner") return null;
  return { role, aal: aal === "aal2" ? "aal2" : "aal1" };
}

/**
 * Decide o acesso no servidor. A identidade vem de auth.getUser() (token validado no Auth) e o nível
 * de autenticação (aal) vem do banco, lido do JWT verificado — nunca de dados do navegador.
 * Falhas inesperadas negam o acesso.
 */
export async function resolvePlatformAccess(supabase: SupabaseClient<Database>): Promise<PlatformAccess> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { state: "unauthenticated" };
  const { data, error } = await supabase.rpc("platform_operator_status");
  if (error) return { state: "error" };
  const status = parseOperatorStatus(data);
  if (!status) return { state: "not_operator" };
  const operator: PlatformOperator = { userId: user.id, email: user.email ?? "", role: status.role, aal: status.aal };
  return operator.aal === "aal2" ? { state: "granted", operator } : { state: "mfa_required", operator };
}
