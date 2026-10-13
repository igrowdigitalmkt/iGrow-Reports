import { NextResponse } from "next/server";
import { requireAgencyContext } from "@/modules/agencies/context";
import { buildAuthUrl, googleAdsAppConfig, googleRedirectUri, signState } from "@/modules/google-ads/server";

export const runtime = "nodejs";

// Inicia a conexão com o Google Ads: só dono e administrador, e só com as credenciais do aplicativo configuradas.
export async function GET() {
  const context = await requireAgencyContext();
  const back = (status: string) => NextResponse.redirect(new URL(`/dashboard/integracoes?google=${status}`, process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  if (context.role !== "owner" && context.role !== "admin") return back("sem-permissao");
  const config = googleAdsAppConfig();
  const redirectUri = googleRedirectUri();
  if (!config.ready || !redirectUri) return back("nao-configurado");
  const state = signState({ agencyId: context.agency.id, userId: context.user.id }, config.clientSecret);
  return NextResponse.redirect(buildAuthUrl({ clientId: config.clientId, redirectUri, state }));
}
