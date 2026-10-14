import { NextResponse } from "next/server";
import { authorizePlatformApi } from "@/modules/platform-admin/guard";

export const dynamic = "force-dynamic";

// Primeira API administrativa: confirma a sessão do operador. Serve de modelo (e de teste) para as
// próximas rotas /api/admin/*, que devem sempre começar por authorizePlatformApi().
export async function GET() {
  const auth = await authorizePlatformApi();
  if (!auth.ok) return auth.response;
  const { operator } = auth;
  return NextResponse.json({ role: operator.role, mfa: operator.aal === "aal2" }, { headers: { "Cache-Control": "private, no-store" } });
}
