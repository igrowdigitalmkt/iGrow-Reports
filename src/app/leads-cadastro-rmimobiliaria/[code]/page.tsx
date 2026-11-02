import type { Metadata } from "next";
import { SharedLeadsPage } from "@/modules/lead-pages/shared-leads-page";

// Endereço original entregue ao cliente (RM Imobiliária): continua valendo; o código antigo virou um link compartilhado do cliente.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = { title: "Cadastros · RM Imobiliária", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <SharedLeadsPage code={(await params).code} />;
}
