import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/modules/auth/redirect";
import { acceptPendingAgencyInvitations } from "@/modules/agencies/invitations";

// Supabase's reason, trimmed to plain text, so the login screen can say what went wrong.
function reason(value: string | null | undefined) {
  return value ? value.replace(/[^\p{L}\p{N} .,:;()'_-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const next = safeRedirect(params.get("next"));
  const supabase = await createSupabaseServerClient();
  let destination = "/entrar?erro=link-invalido";
  // Errors from Supabase or the provider (e.g. Google) come as query parameters instead of a code.
  const providerError = reason(params.get("error_description") ?? params.get("error_code") ?? params.get("error"));
  if (!supabase) destination = "/entrar?estado=nao-configurado";
  else if (providerError) {
    console.error("auth-callback-provider-error", { code: params.get("error_code"), error: params.get("error") });
    destination = `/entrar?erro=acesso&motivo=${encodeURIComponent(providerError)}`;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) { await acceptPendingAgencyInvitations(supabase); destination = next; }
    else {
      console.error("auth-callback-exchange-failed", { code: error.code ?? null, status: error.status ?? null });
      destination = `/entrar?erro=acesso&motivo=${encodeURIComponent(reason(error.code ?? error.message) || "troca do código recusada")}`;
    }
  }
  // A relative Location keeps the redirect on the serving origin, including previews; the empty
  // fragment drops any error fragment so the login page shows a single message.
  return new NextResponse(null, { status: 303, headers: { Location: `${destination}#`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
