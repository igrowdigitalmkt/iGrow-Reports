import type { Metadata } from "next";
import { SharedLeadsPage } from "@/modules/lead-pages/shared-leads-page";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Dados pessoais: fora dos buscadores e sem repassar o endereço (que contém o código) a outros sites.
export const metadata: Metadata = { title: "Leads", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <SharedLeadsPage code={(await params).code} />;
}
