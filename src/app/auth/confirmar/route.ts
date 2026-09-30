import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const supabase = await createSupabaseServerClient();
  let destination = "/entrar?erro=link-invalido";
  if (!supabase) destination = "/entrar?estado=nao-configurado";
  else if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) destination = "/auth/definir-senha";
  }
  return new NextResponse(null, { status: 303, headers: { Location: destination, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

