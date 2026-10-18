import { NextResponse, type NextRequest } from "next/server";
import { requireAgencyContext } from "@/modules/agencies/context";
import { exchangeCode, googleAdsAppConfig, googleRedirectUri, googleServiceClient, saveGoogleConnection, verifyState } from "@/modules/google-ads/server";

export const runtime = "nodejs";

// Retorno do Google: confere quem iniciou a conexão, troca o código pelo token de renovação e guarda cifrado.
export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const back = (status: string) => NextResponse.redirect(new URL(`/integracoes?google=${status}`, base));
  const context = await requireAgencyContext();
  const config = googleAdsAppConfig();
  const redirectUri = googleRedirectUri();
  if (!config.ready || !redirectUri) return back("nao-configurado");
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("negado");
  const state = verifyState(params.get("state") ?? "", config.clientSecret);
  const code = params.get("code");
  // O mesmo usuário e a mesma organização que iniciaram; dono e administrador apenas.
  if (!state || !code || state.userId !== context.user.id || state.agencyId !== context.agency.id) return back("estado-invalido");
  if (context.role !== "owner" && context.role !== "admin") return back("sem-permissao");
  try {
    const token = await exchangeCode({ code, clientId: config.clientId, clientSecret: config.clientSecret, redirectUri });
    await saveGoogleConnection(googleServiceClient(), { agencyId: context.agency.id, refreshToken: token.refreshToken, scopes: token.scopes });
    return back("conectado");
  } catch {
    return back("falhou");
  }
}
