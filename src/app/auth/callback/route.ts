import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/modules/auth/redirect";
import { acceptPendingAgencyInvitations } from "@/modules/agencies/invitations";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirect(request.nextUrl.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();
  let destination = "/entrar?erro=link-invalido";
  if (!supabase) destination = "/entrar?estado=nao-configurado";
  else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) { await acceptPendingAgencyInvitations(supabase); destination = next; }
  }
  // A relative Location keeps the redirect on the serving origin, including previews.
  return new NextResponse(null, { status: 303, headers: { Location: destination, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

