import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { LeadFeedView } from "@/modules/lead-pages/lead-feed-view";
import { loadLeadFeed, openLeadPage } from "@/modules/lead-pages/store";

const SLUG = "leads-cadastro-rmimobiliaria";

export const dynamic = "force-dynamic";
// Dados pessoais: fora dos buscadores e sem repassar o endereço (que contém o código) a outros sites.
export const metadata: Metadata = { title: "Cadastros · RM Imobiliária", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const service = createSupabaseServiceClient();
  if (!service) notFound();
  const page = await openLeadPage(service, SLUG, code);
  if (!page) notFound();
  const feed = await loadLeadFeed(service, page);
  if (!feed) throw new Error("Não foi possível carregar os cadastros.");
  return <LeadFeedView slug={SLUG} code={code} initial={feed} />;
}
