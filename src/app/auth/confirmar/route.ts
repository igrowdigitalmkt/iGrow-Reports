import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptPendingClientInvitations } from "@/modules/client-portal/invitations";
import { needsPasswordSetup } from "@/modules/auth/password-state";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const supabase = await createSupabaseServerClient();
  let destination = "/entrar?erro=link-invalido";
  if (!supabase) destination = "/entrar?estado=nao-configurado";
  else if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) destination = "/auth/definir-senha";
  } else if (tokenHash && (type === "magiclink" || type === "email")) {
    // Existing accounts invited to the client portal follow a sign-in link.
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      await acceptPendingClientInvitations(supabase);
      destination = needsPasswordSetup(data?.user) ? "/auth/definir-senha" : "/dashboard";
    }
  }
  return new NextResponse(null, { status: 303, headers: { Location: destination, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

