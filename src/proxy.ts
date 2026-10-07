import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { getSupabaseConfig, isDemoEnabled } from "@/lib/env";

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
  if ((path === "/dashboard" || path.startsWith("/dashboard/") || path === "/cliente" || path.startsWith("/cliente/")) && !getSupabaseConfig()) {
    const response = NextResponse.redirect(new URL("/entrar?estado=nao-configurado", request.url));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/demo/:path*", "/dashboard/:path*", "/cliente/:path*", "/entrar", "/selecionar-espaco", "/selecionar-agencia", "/sem-acesso", "/convite", "/auth/:path*", "/criar-conta", "/recuperar-senha", "/criar-espaco"],
};

