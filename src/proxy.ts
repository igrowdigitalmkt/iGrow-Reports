import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { getSupabaseConfig, isDemoEnabled } from "@/lib/env";
import { gateAdminRequest } from "@/modules/platform-admin/proxy-gate";
import { isAuthCookie } from "@/lib/supabase/constants";

const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");
const workspacePaths = ["/clientes", "/agendamentos", "/relatorios", "/integracoes", "/equipe", "/configuracoes", "/whatsapp", "/assinatura", "/entregas", "/templates", "/dashboard"];
const isWorkspacePath = (path: string) => workspacePaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Gate before streaming begins so a disabled demo returns an actual HTTP 404.
  if (path === "/demo" || path.startsWith("/demo/")) {
    if (!isDemoEnabled()) return new NextResponse("Demonstração desativada neste ambiente.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
    return NextResponse.next();
  }
  if ((isWorkspacePath(path) || path === "/cliente" || path.startsWith("/cliente/") || isAdminPath(path)) && !getSupabaseConfig()) {
    const response = NextResponse.redirect(new URL("/entrar?estado=nao-configurado", request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  // Decide before a loading boundary can stream HTTP 200. Cookie presence is
  // only a cheap redirect check; identity and authorization remain server-side.
  if ((isAdminPath(path) || isWorkspacePath(path)) && !request.cookies.getAll().some(({ name }) => isAuthCookie(name))) {
    const next = path + request.nextUrl.search;
    const response = NextResponse.redirect(new URL(`/entrar?next=${encodeURIComponent(next)}`, request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return updateSession(request, isAdminPath(path) ? gateAdminRequest : undefined);
}

export const config = {
  matcher: ["/", "/clientes/:path*", "/agendamentos/:path*", "/relatorios/:path*", "/integracoes/:path*", "/equipe/:path*", "/configuracoes/:path*", "/whatsapp/:path*", "/assinatura/:path*", "/entregas/:path*", "/templates/:path*", "/demo/:path*", "/dashboard/:path*", "/cliente/:path*", "/admin/:path*", "/entrar", "/selecionar-espaco", "/selecionar-agencia", "/sem-acesso", "/convite", "/auth/:path*", "/criar-conta", "/recuperar-senha", "/criar-espaco"],
};

