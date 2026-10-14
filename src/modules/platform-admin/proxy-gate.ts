import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolvePlatformAccess } from "./access";

// Rota inexistente: a reescrita para ela devolve um 404 de verdade (o status é definido antes do
// streaming, o que não acontece com notFound() dentro de páginas sob o loading.tsx da raiz).
export const ADMIN_NOT_FOUND_PATH = "/nao-encontrado-admin";

/**
 * Primeira camada do /admin, só para devolver o status HTTP correto: 404 a quem não é operador e
 * redirecionamento a quem ainda não validou o MFA. NÃO é a proteção: páginas, ações e APIs conferem
 * o acesso de novo no servidor. Falha inesperada segue adiante e é negada pelas guardas.
 */
export async function gateAdminRequest(supabase: SupabaseClient<Database>, request: NextRequest): Promise<NextResponse | null> {
  const path = request.nextUrl.pathname;
  let access;
  try { access = await resolvePlatformAccess(supabase); } catch { return null; }
  switch (access.state) {
    case "unauthenticated": return NextResponse.redirect(new URL(`/entrar?next=${encodeURIComponent(path)}`, request.url));
    case "not_operator": return NextResponse.rewrite(new URL(ADMIN_NOT_FOUND_PATH, request.url), { status: 404 });
    case "mfa_required": return path === "/admin/mfa" ? null : NextResponse.redirect(new URL("/admin/mfa", request.url));
    default: return null;
  }
}
